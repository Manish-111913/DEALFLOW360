import { Prisma } from "../generated/prisma/client";
import type { ApprovalState, Role } from "../generated/prisma/enums";
import { appendAudit } from "../audit";
import { assertCan, type AuthzUser } from "../authz/roles";
import { isDenyAll, scopeFor } from "../authz/scope";
import { currentBusinessTime } from "../clock";
import { prisma } from "../db";
import { isPendingApproval } from "../domain/approval";
import { publishDealEvent } from "../realtime/events";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import {
  resolveApprovalRoute,
  type ApprovalStepConfig,
} from "../engines/approval-routing";
import { assertQuotationVisible } from "./quotations";
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

    /**
     * The seller has answered, so the round the customer opened is over.
     *
     * Without this the portal deadlocked. `portalStatusFor` reports an open
     * negotiation as "Under Negotiation", which ranks above "Ready to Confirm",
     * and the portal only offers the Confirm button on "Ready to Confirm" - so
     * a customer who asked for a discount and got it was still shown "Under
     * Negotiation" with Confirm greyed out. The only code that closed a
     * negotiation was `confirmQuotation` itself, the very act being blocked:
     * the negotiation could not close until the customer confirmed, and the
     * customer could not confirm until the negotiation closed.
     *
     * Approval is the right place to close it because approval IS the answer.
     * A rejection deliberately does not close anything - those terms were
     * refused, and the conversation is still open.
     */
    await prisma.negotiation.updateMany({
      where: { quotationId: params.quotationId, status: "OPEN" },
      data: { status: "CLOSED", closedAt: params.now },
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
    include: {
      step: true,
      // customerId and salesRepId are carried so a decision can be announced
      // to exactly the people entitled to hear it.
      quotation: {
        select: { id: true, quoteNumber: true, customerId: true, salesRepId: true },
      },
    },
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
    // A rejection or return is a decision the customer is waiting on too.
    await publishDealEvent({
      type: "APPROVAL_COMPLETED",
      quotationId: request.quotationId,
      customerId: request.quotation.customerId,
      salesRepId: request.quotation.salesRepId,
      at: now.getTime(),
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

  // `APPROVAL_COMPLETED` when the quotation is through the whole chain, and
  // `APPROVAL_REQUIRED` when one desk has cleared it and the next now owns it -
  // which is a different thing for the next reviewer's queue to hear about.
  await publishDealEvent({
    type: to === "APPROVED" ? "APPROVAL_COMPLETED" : "APPROVAL_REQUIRED",
    quotationId: request.quotationId,
    customerId: request.quotation.customerId,
    salesRepId: request.quotation.salesRepId,
    at: now.getTime(),
  });

  return {
    approvalState: to,
    requestStatus: status,
    nextApprover: nextPending?.step.approverRole ?? null,
  };
}

/**
 * Everything the approval screen needs, including the risk breakdown.
 *
 * The risk factors and the approver chain are internal deliberation, never the
 * customer's to read - so the caller is asserted here rather than trusted to
 * have been asserted upstream (D20).
 */
/**
 * The quotations this user is actually being asked to decide.
 *
 * This exists because the approval queue was built from the ownership row scope
 * - `listQuotations(user, { stage: "PENDING_APPROVAL" })` - and owning a deal
 * and being asked to approve one are different questions. A Sales Manager is
 * scoped to their own team, so a quotation raised by anyone outside it was
 * routed to them for a decision they could not open. Seen from the database it
 * was unambiguous: every role that had to decide one such quote could not see
 * it, and the only role that could see it had no `decide` capability. The deal
 * sat PENDING_MANAGER with nobody on earth able to move it.
 *
 * Being asked to decide something is itself the grant. It is a narrow one - the
 * request must be PENDING, its step must belong to this user's role, and if it
 * names an assignee it must be this user - so it widens sight to exactly the
 * deals that would otherwise be stuck, and not one more.
 */
export async function listAwaitingDecision(user: AuthzUser): Promise<string[]> {
  if (user.kind !== "INTERNAL" || !user.role) return [];
  // Only the two reviewing roles are ever put on a step, so nobody else can
  // acquire sight of a deal this way.
  if (user.role !== "SALES_MANAGER" && user.role !== "FINANCE_OPS") return [];

  const requests = await prisma.approvalRequest.findMany({
    where: {
      status: "PENDING",
      step: { approverRole: user.role },
      // Narrow on purpose. `assignedToId` is never populated - nothing in the
      // codebase writes it - so matching "unassigned" would match every pending
      // request of this role and hand a manager the other team's book. The only
      // deals that genuinely need this widening are the orphans: a quotation
      // whose owner belongs to no sales team is inside no team-scoped manager's
      // view, so without this nobody could ever decide it. Everything else stays
      // where D6 put it.
      quotation: {
        // A decided or cancelled quotation is not awaiting anything, whatever
        // its stale requests say.
        approvalState: { in: ["PENDING_MANAGER", "PENDING_FINANCE"] },
        salesRep: { salesTeamId: null },
      },
    },
    select: { quotationId: true },
  });

  return [...new Set(requests.map((request) => request.quotationId))];
}

export interface DecisionQueueRow {
  id: string;
  quoteNumber: string;
  customerName: string;
  totalAmount: string;
  riskScore: string;
}

/**
 * Everything on this reviewer's desk: their own pending deals, plus the ones
 * they have been asked to decide that belong to someone else's book.
 *
 * Merged here rather than in the page because the second half is a deliberate
 * widening of row scope, and a widening of scope should live next to the rule
 * that justifies it - not in a React component where the next person to touch
 * the screen would have to rediscover why it is safe.
 */
export async function listDecisionQueue(user: AuthzUser): Promise<DecisionQueueRow[]> {
  assertCan(user, "view", "quotation");

  const scope = scopeFor(user, "Quotation");
  const awaitingMe = await listAwaitingDecision(user);

  const rows = await prisma.quotation.findMany({
    where: {
      approvalState: { in: ["PENDING_MANAGER", "PENDING_FINANCE"] },
      OR: [
        // Theirs to see...
        ...(isDenyAll(scope) ? [] : [scope as Prisma.QuotationWhereInput]),
        // ...or theirs to decide.
        ...(awaitingMe.length > 0 ? [{ id: { in: awaitingMe } }] : []),
      ],
    },
    orderBy: { lastActivityAt: "desc" },
    select: {
      id: true,
      quoteNumber: true,
      totalAmount: true,
      riskScore: true,
      customer: { select: { name: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    quoteNumber: row.quoteNumber,
    customerName: row.customer.name,
    totalAmount: row.totalAmount.toFixed(2),
    riskScore: row.riskScore.toFixed(2),
  }));
}

/**
 * Read one quotation for the approvals screen.
 *
 * Visible either because it is in the caller's own book, or because they are the
 * one being asked to decide it. `assertQuotationVisible` alone answers only the
 * first, which is why an approver met a 404 on the very deal sitting in their
 * queue.
 */
export async function assertQuotationDecidable(
  user: AuthzUser,
  quotationId: string,
): Promise<void> {
  try {
    await assertQuotationVisible(user, quotationId);
    return;
  } catch (error) {
    const awaiting = await listAwaitingDecision(user);
    if (!awaiting.includes(quotationId)) throw error;
  }
}

export async function getApprovalOverview(user: AuthzUser, quotationId: string) {
  assertCan(user, "view", "riskDetail");

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
