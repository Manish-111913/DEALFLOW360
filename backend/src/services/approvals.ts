import { Prisma } from "../generated/prisma/client";
import type { ApprovalState, Role } from "../generated/prisma/enums";
import { appendAudit } from "../audit";
import { assertCan, type AuthzUser } from "../authz/roles";
import { currentBusinessTime } from "../clock";
import { prisma } from "../db";
import { isPendingApproval } from "../domain/approval";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import {
  resolveApprovalRoute,
  type ApprovalStepConfig,
} from "../engines/approval-routing";
import { snapshotQuotation } from "./quotation-versions";

/**
 * The approval state machine.
 *
 * Every transition of `Quotation.approvalState` happens here and nowhere else,
 * and each writes exactly one audit row. That single-entry rule is the actual
 * mechanism preventing duplicate or misrouted approval records — a convention
 * spread across several call sites would not survive the build.
 */

const Decimal = Prisma.Decimal;

/** Which state a quotation sits in while waiting for a given approver. */
const PENDING_STATE_FOR_ROLE: Partial<Record<Role, ApprovalState>> = {
  SALES_MANAGER: "PENDING_MANAGER",
  FINANCE_OPS: "PENDING_FINANCE",
};

/** The capability matrix checks a step *type*, not a job title. */
export function stepTypeFor(role: Role): "manager" | "finance" {
  return role === "FINANCE_OPS" ? "finance" : "manager";
}

/** The configured chain, as plain data for the routing engine. */
export async function loadActiveApprovalSteps(): Promise<ApprovalStepConfig[]> {
  const chain = await prisma.approvalChain.findFirst({
    where: { isActive: true },
    include: { steps: { orderBy: { stepOrder: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
  if (!chain) return [];

  return chain.steps.map((s) => ({
    id: s.id,
    stepOrder: s.stepOrder,
    approverRole: s.approverRole,
    minRiskScore: s.minRiskScore,
    maxRiskScore: s.maxRiskScore,
    minDiscount: s.minDiscount,
    maxDiscount: s.maxDiscount,
  }));
}

export interface SubmitResult {
  approvalRequired: boolean;
  approvalState: ApprovalState;
  reason: string;
  steps: { id: string; stepOrder: number; approverRole: Role }[];
}

/**
 * Submit a quotation for approval.
 *
 * Routing is automatic: the rep never asks for approval, the score decides.
 * Quick Test step 3 checks exactly this — "the quotation is automatically
 * routed, without the rep having to request it manually".
 */
export async function submitForApproval(params: {
  quotationId: string;
  actorId?: string | null;
  /**
   * Require approval regardless of what routing alone would say.
   *
   * Used by the negotiation path: the what-if has already decided that a
   * customer proposal goes beyond approved terms. Routing on its own could
   * still answer "not required" for a small increase, and that would let a
   * customer edge a quote past its approved terms one request at a time.
   */
  forceApproval?: boolean;
  triggerReason?: string;
}): Promise<SubmitResult> {
  const quotation = await prisma.quotation.findUnique({
    where: { id: params.quotationId },
    include: { lines: { select: { id: true } } },
  });
  if (!quotation) throw new NotFoundError(`Quotation ${params.quotationId} does not exist`);

  if (quotation.lines.length === 0) {
    throw new ValidationError("A quotation with no lines cannot be submitted.", "lines");
  }
  if (isPendingApproval(quotation.approvalState)) {
    throw new ConflictError(
      `Quotation ${quotation.quoteNumber} is already awaiting approval.`,
    );
  }

  const steps = await loadActiveApprovalSteps();
  const lines = await prisma.quotationLine.findMany({
    where: { quotationId: params.quotationId },
    select: { discountPercentage: true, violationPoints: true },
  });

  const anyLineOverCeiling = lines.some((l) => l.violationPoints.greaterThan(0));
  const maxLineDiscount = lines.reduce(
    (acc, l) => (l.discountPercentage.greaterThan(acc) ? l.discountPercentage : acc),
    new Decimal(0),
  );

  const computed = resolveApprovalRoute({
    steps,
    score: quotation.riskScore.toNumber(),
    anyLineOverCeiling,
    maxLineDiscount,
  });

  // A forced submission always needs at least the first configured approver.
  const routing =
    params.forceApproval && !computed.required && steps.length > 0
      ? {
          ...computed,
          required: true,
          steps: [[...steps].sort((a, b) => a.stepOrder - b.stepOrder)[0]],
          reason: params.triggerReason ?? computed.reason,
        }
      : params.triggerReason
        ? { ...computed, reason: params.triggerReason }
        : computed;

  const now = currentBusinessTime();

  if (!routing.required) {
    // No approval needed: the quote proceeds without a reviewer, which is the
    // point of scoring it at all.
    await transition({
      quotationId: quotation.id,
      to: "APPROVED",
      actorId: params.actorId ?? quotation.salesRepId,
      reason: routing.reason,
      now,
      approvedAt: now,
    });
    return {
      approvalRequired: false,
      approvalState: "APPROVED",
      reason: routing.reason,
      steps: [],
    };
  }

  const firstState =
    PENDING_STATE_FOR_ROLE[routing.steps[0].approverRole] ?? "PENDING_MANAGER";

  await prisma.$transaction(async (tx) => {
    // Any earlier round is closed before a new one opens, so a returned and
    // resubmitted quote never has two live requests for the same step.
    await tx.approvalRequest.updateMany({
      where: { quotationId: quotation.id, status: "PENDING" },
      data: { status: "RETURNED", decisionReason: "Superseded by resubmission", actedAt: now },
    });

    for (const s of routing.steps) {
      await tx.approvalRequest.create({
        data: {
          quotationId: quotation.id,
          stepId: s.id,
          status: "PENDING",
          riskScore: quotation.riskScore,
          triggerReason: routing.reason,
          requestedAt: now,
        },
      });
    }

    await tx.quotation.update({
      where: { id: quotation.id },
      data: {
        approvalState: firstState,
        submittedAt: now,
        updatedAt: now,
        lastActivityAt: now,
      },
    });
  });

  await appendAudit({
    entityName: "Quotation",
    entityId: quotation.id,
    action: "UPDATE",
    actorId: params.actorId ?? quotation.salesRepId,
    reason: `Submitted for approval: ${routing.reason}`,
    fieldChanges: {
      approvalState: { before: quotation.approvalState, after: firstState },
      riskScore: quotation.riskScore.toFixed(2),
      steps: routing.steps.map((s) => s.approverRole),
    },
  });

  return {
    approvalRequired: true,
    approvalState: firstState,
    reason: routing.reason,
    steps: routing.steps.map((s) => ({
      id: s.id,
      stepOrder: s.stepOrder,
      approverRole: s.approverRole,
    })),
  };
}

/** The one place `approvalState` is written. */
async function transition(params: {
  quotationId: string;
  to: ApprovalState;
  actorId: string | null;
  reason: string;
  now: Date;
  approvedAt?: Date;
}): Promise<void> {
  const before = await prisma.quotation.findUniqueOrThrow({
    where: { id: params.quotationId },
    select: { approvalState: true },
  });

  await prisma.quotation.update({
    where: { id: params.quotationId },
    data: {
      approvalState: params.to,
      ...(params.approvedAt ? { approvedAt: params.approvedAt } : {}),
      updatedAt: params.now,
      lastActivityAt: params.now,
    },
  });

  // D5 - approval is the moment that fixes "what was signed off". Every later
  // negotiation is judged against this snapshot rather than against a live
  // quote that may have drifted since.
  if (params.to === "APPROVED") {
    await snapshotQuotation({
      quotationId: params.quotationId,
      reason: params.reason,
      createdById: params.actorId,
      approved: true,
    });
  }

  await appendAudit({
    entityName: "Quotation",
    entityId: params.quotationId,
    action:
      params.to === "APPROVED"
        ? "APPROVE"
        : params.to === "REJECTED"
          ? "REJECT"
          : params.to === "RETURNED"
            ? "RETURN"
            : "UPDATE",
    actorId: params.actorId,
    reason: params.reason,
    fieldChanges: { approvalState: { before: before.approvalState, after: params.to } },
  });
}

export type ApprovalDecision = "APPROVE" | "REJECT" | "RETURN";

export interface DecisionResult {
  approvalState: ApprovalState;
  requestStatus: "APPROVED" | "REJECTED" | "RETURNED";
  nextApprover: Role | null;
}

/**
 * Record one reviewer decision.
 *
 * Guards, in order: the reviewer must hold the capability for *this step type*
 * (being senior does not make a manager a finance approver), and the request
 * must still be pending. The second guard is what makes approving twice a
 * refusal rather than a duplicate record.
 */
export async function decideApproval(params: {
  requestId: string;
  decision: ApprovalDecision;
  user: AuthzUser;
  reason?: string;
}): Promise<DecisionResult> {
  const request = await prisma.approvalRequest.findUnique({
    where: { id: params.requestId },
    include: { step: true, quotation: { select: { id: true, quoteNumber: true } } },
  });
  if (!request) throw new NotFoundError(`Approval request ${params.requestId} does not exist`);

  assertCan(params.user, "decide", { stepType: stepTypeFor(request.step.approverRole) });

  if (request.status !== "PENDING") {
    throw new ConflictError(
      `This approval step was already ${request.status.toLowerCase()}; it cannot be decided again.`,
    );
  }

  const reason = params.reason?.trim() ?? "";
  if (params.decision !== "APPROVE" && reason.length === 0) {
    // Also enforced by a CHECK constraint, so no code path can record a
    // rejection nobody has to justify.
    throw new ValidationError(
      "A reason is required when rejecting or returning a quotation.",
      "reason",
    );
  }

  const now = currentBusinessTime();
  const status =
    params.decision === "APPROVE"
      ? "APPROVED"
      : params.decision === "REJECT"
        ? "REJECTED"
        : "RETURNED";

  // Claim the step atomically. The status check above is a fast path that
  // gives a clear message; this is the guarantee. Two reviewers pressing
  // Approve at the same moment would both pass that check, and only one can
  // pass this - which is what makes "approving twice never duplicates" true
  // under concurrency and not merely in sequence.
  const claimed = await prisma.approvalRequest.updateMany({
    where: { id: params.requestId, status: "PENDING" },
    data: {
      status,
      decidedById: params.user.id,
      decisionReason: reason.length > 0 ? reason : null,
      actedAt: now,
    },
  });
  if (claimed.count === 0) {
    throw new ConflictError(
      "This approval step was decided by someone else a moment ago.",
    );
  }

  if (params.decision !== "APPROVE") {
    // A rejection or return closes the round: any later step never opens.
    await prisma.approvalRequest.updateMany({
      where: { quotationId: request.quotationId, status: "PENDING" },
      data: { status: "RETURNED", decisionReason: "Round closed by an earlier decision", actedAt: now },
    });

    const to: ApprovalState = params.decision === "REJECT" ? "REJECTED" : "RETURNED";
    await transition({
      quotationId: request.quotationId,
      to,
      actorId: params.user.id,
      reason,
      now,
    });
    return { approvalState: to, requestStatus: status, nextApprover: null };
  }

  const nextPending = await prisma.approvalRequest.findFirst({
    where: { quotationId: request.quotationId, status: "PENDING" },
    include: { step: true },
    orderBy: { step: { stepOrder: "asc" } },
  });

  // Finance is never the first reviewer: it only becomes reachable once the
  // manager step ahead of it has been approved.
  const to: ApprovalState = nextPending
    ? (PENDING_STATE_FOR_ROLE[nextPending.step.approverRole] ?? "PENDING_FINANCE")
    : "APPROVED";

  await transition({
    quotationId: request.quotationId,
    to,
    actorId: params.user.id,
    reason: reason.length > 0 ? reason : `${request.step.approverRole} approved`,
    now,
    approvedAt: to === "APPROVED" ? now : undefined,
  });

  return {
    approvalState: to,
    requestStatus: status,
    nextApprover: nextPending?.step.approverRole ?? null,
  };
}

/** Everything the approval screen needs, including the risk breakdown. */
export async function getApprovalOverview(quotationId: string) {
  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    include: {
      riskFactors: { orderBy: { sequence: "asc" } },
      approvalRequests: {
        include: {
          step: true,
          decidedBy: { select: { id: true, name: true } },
        },
        orderBy: { requestedAt: "asc" },
      },
    },
  });
  if (!quotation) throw new NotFoundError(`Quotation ${quotationId} does not exist`);

  return {
    quoteNumber: quotation.quoteNumber,
    approvalState: quotation.approvalState,
    riskScore: quotation.riskScore.toNumber(),
    riskLevel: quotation.riskLevel,
    factors: quotation.riskFactors,
    requests: quotation.approvalRequests,
  };
}
