import { Prisma } from "../generated/prisma/client";
import type { NegotiationRequestType, Role } from "../generated/prisma/enums";
import { appendAudit } from "../audit";
import type { AuthzUser } from "../authz/roles";
import { scopeFor } from "../authz/scope";
import { currentBusinessTime } from "../clock";
import { prisma } from "../db";
import { NotFoundError, ValidationError } from "../errors";
import { evaluateWhatIf, type LineTerms, type WhatIfResult } from "../engines/negotiation";
import { resolveApprovalRoute } from "../engines/approval-routing";
import { loadActiveApprovalSteps, submitForApproval } from "./approvals";
import { lastApprovedSnapshot, snapshotQuotation } from "./quotation-versions";
import { recomputeQuotation } from "./quotations";

/**
 * The customer-facing surface.
 *
 * ---------------------------------------------------------------------------
 * D20 - THIS IS A DIFFERENT SURFACE, NOT A NARROWER INTERNAL ONE
 * ---------------------------------------------------------------------------
 * §7 of the problem statement calls this out by name: the negotiation screen
 * "must be a real, separate, restricted view, not just another internal screen
 * with a different label".
 *
 * Two mechanisms enforce that here:
 *
 *   toPortalQuotation()  builds the response by *whitelisting* fields. Adding a
 *                        column to Quotation cannot leak it, because nothing
 *                        copies fields it has not been told to copy.
 *
 *   portalStatusFor()    projects the internal state machine onto the three
 *                        values §B8 names - Sent, Under Negotiation, Confirmed.
 *                        A customer never sees PENDING_FINANCE.
 *
 * Cost, margin, risk score, risk level, ceilings, violation points and approval
 * state are all absent by construction. A test asserts their absence.
 */

const Decimal = Prisma.Decimal;

// ---------------------------------------------------------------------------
// The projection
// ---------------------------------------------------------------------------

export type PortalStatus = "Sent" | "Under Negotiation" | "Confirmed";

export interface PortalQuotationLine {
  lineId: string;
  productName: string;
  quantity: number;
  unitPrice: string;
  discountPercentage: string;
  lineTotal: string;
  taxAmount: string;
}

export interface PortalQuotation {
  quoteNumber: string;
  status: PortalStatus;
  currency: string;
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  totalAmount: string;
  validUntil: string | null;
  lines: PortalQuotationLine[];
  /** Only the customer-visible thread. Approval comments never appear here. */
  conversation: {
    requests: {
      id: string;
      lineId: string | null;
      requestType: NegotiationRequestType;
      requestedValue: string | null;
      reason: string | null;
      status: string;
      createdAt: Date;
    }[];
    comments: { id: string; lineId: string | null; message: string; createdAt: Date }[];
  };
  /** True when the seller is still reviewing. Deliberately not "why". */
  awaitingSellerReview: boolean;
}

type QuotationForPortal = Prisma.QuotationGetPayload<{
  include: {
    lines: { include: { product: { select: { name: true } } } };
    negotiations: { include: { requests: true; comments: true } };
  };
}>;

/**
 * §B8 - the customer status vocabulary, projected from internal state.
 *
 * The internal approval state machine has six values and none of them belong on
 * a customer screen. "Under review by the seller" is all a customer is told.
 */
function portalStatusFor(quotation: QuotationForPortal): PortalStatus {
  if (quotation.status === "CONFIRMED") return "Confirmed";
  if (quotation.negotiations.some((n) => n.status === "OPEN")) return "Under Negotiation";
  return "Sent";
}

function toPortalQuotation(quotation: QuotationForPortal): PortalQuotation {
  const openNegotiations = quotation.negotiations.filter((n) => n.status === "OPEN");

  return {
    quoteNumber: quotation.quoteNumber,
    status: portalStatusFor(quotation),
    currency: quotation.currency,
    subtotal: quotation.subtotal.toFixed(2),
    discountAmount: quotation.discountAmount.toFixed(2),
    taxAmount: quotation.taxAmount.toFixed(2),
    totalAmount: quotation.totalAmount.toFixed(2),
    validUntil: quotation.validUntil?.toISOString() ?? null,
    lines: quotation.lines.map((l) => ({
      lineId: l.id,
      productName: l.product.name,
      quantity: l.quantity,
      unitPrice: l.unitPrice.toFixed(2),
      discountPercentage: l.discountPercentage.toFixed(2),
      lineTotal: l.lineTotal.toFixed(2),
      taxAmount: l.taxAmount.toFixed(2),
    })),
    conversation: {
      requests: quotation.negotiations.flatMap((n) =>
        n.requests.map((r) => ({
          id: r.id,
          lineId: r.quotationLineId,
          requestType: r.requestType,
          requestedValue: r.requestedValue?.toFixed(2) ?? null,
          reason: r.reason,
          status: r.status,
          createdAt: r.createdAt,
        })),
      ),
      comments: quotation.negotiations.flatMap((n) =>
        n.comments.map((c) => ({
          id: c.id,
          lineId: c.quotationLineId,
          message: c.message,
          createdAt: c.createdAt,
        })),
      ),
    },
    awaitingSellerReview:
      openNegotiations.length > 0 && quotation.approvalState !== "APPROVED",
  };
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

const PORTAL_INCLUDE = {
  lines: {
    orderBy: { sequence: "asc" as const },
    include: { product: { select: { name: true } } },
  },
  negotiations: {
    include: {
      requests: { orderBy: { createdAt: "asc" as const } },
      comments: { orderBy: { createdAt: "asc" as const } },
    },
  },
};

/**
 * Load a quotation for a portal user, or say why not.
 *
 * A record that exists but belongs to someone else returns 403, not 404. An
 * empty page would read as "found but hidden"; 403 correctly says "not yours",
 * which is what 05_SECURITY.md asks for by name.
 */
async function loadForPortal(
  user: AuthzUser | null,
  quotationId: string,
): Promise<
  | { status: 200; quotation: QuotationForPortal }
  | { status: 401 | 403 | 404 }
> {
  if (!user) return { status: 401 };
  if (user.kind !== "PORTAL") return { status: 403 };

  const scope = scopeFor(user, "Quotation");
  const inScope = await prisma.quotation.findFirst({
    where: { AND: [{ id: quotationId }, scope] },
    include: PORTAL_INCLUDE,
  });
  if (inScope) {
    // A quote the seller has not shared is not visible, even to its own owner.
    if (inScope.portalStatus === "NOT_SHARED") return { status: 404 };
    return { status: 200, quotation: inScope };
  }

  const exists = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: { id: true },
  });
  return { status: exists ? 403 : 404 };
}

export type PortalViewResult =
  | { status: 200; quotation: PortalQuotation }
  | { status: 401 | 403 | 404 };

/** GET /my/quotations/:id */
export async function viewPortalQuotation(
  user: AuthzUser | null,
  quotationId: string,
): Promise<PortalViewResult> {
  const loaded = await loadForPortal(user, quotationId);
  if (loaded.status !== 200) return { status: loaded.status };
  return { status: 200, quotation: toPortalQuotation(loaded.quotation) };
}

/** Make a quotation visible in the portal. An internal action. */
export async function shareWithCustomer(params: {
  quotationId: string;
  actorId?: string | null;
}): Promise<void> {
  const now = currentBusinessTime();
  await prisma.quotation.update({
    where: { id: params.quotationId },
    data: { portalStatus: "SENT", updatedAt: now, lastActivityAt: now },
  });
  await appendAudit({
    entityName: "Quotation",
    entityId: params.quotationId,
    action: "UPDATE",
    actorId: params.actorId ?? null,
    reason: "Shared with the customer portal",
    fieldChanges: { portalStatus: { before: "NOT_SHARED", after: "SENT" } },
  });
}

// ---------------------------------------------------------------------------
// Negotiation
// ---------------------------------------------------------------------------

export type NegotiationOutcome =
  | "ACCEPTED_NO_REAPPROVAL"
  | "ACCEPTED_PENDING_APPROVAL"
  | "SUBMITTED";

export type NegotiateResult =
  | {
      status: 200;
      outcome: NegotiationOutcome;
      requestId: string;
      /** Present for counter-discounts. Never returned to the customer verbatim. */
      whatIf: WhatIfResult | null;
    }
  | { status: 401 | 403 | 404 }
  | { status: 422; error: string; field?: string };

/**
 * POST /my/quotations/:id/negotiate
 *
 * A counter-discount is evaluated against the last approved snapshot (D5), not
 * against the live quote. Both outcomes apply the requested terms; the only
 * difference is whether a human has to look again.
 *
 * The terms are applied before the verdict is computed, which is safe precisely
 * because both branches apply them - and it means the score being compared is
 * the real recomputed one rather than a parallel calculation that could drift
 * from the engine.
 */
export async function submitNegotiation(params: {
  user: AuthzUser | null;
  quotationId: string;
  requestType: NegotiationRequestType;
  lineId?: string | null;
  requestedValue?: number | string | null;
  reason?: string | null;
}): Promise<NegotiateResult> {
  const loaded = await loadForPortal(params.user, params.quotationId);
  if (loaded.status !== 200) return { status: loaded.status };

  const user = params.user as AuthzUser;
  const quotation = loaded.quotation;
  const now = currentBusinessTime();

  if (params.requestType === "COUNTER_DISCOUNT") {
    if (params.requestedValue === null || params.requestedValue === undefined) {
      return { status: 422, error: "A counter-discount needs a percentage.", field: "requestedValue" };
    }
    const requested = new Decimal(params.requestedValue);
    if (requested.lessThan(0) || requested.greaterThan(100)) {
      return { status: 422, error: "Discount must be between 0 and 100 percent.", field: "requestedValue" };
    }
    if (!params.lineId) {
      return { status: 422, error: "A counter-discount must name a line.", field: "lineId" };
    }
    if (!quotation.lines.some((l) => l.id === params.lineId)) {
      return { status: 404 };
    }
  }

  // One open negotiation per quotation; further requests join the same thread.
  const negotiation =
    (await prisma.negotiation.findFirst({
      where: { quotationId: quotation.id, status: "OPEN" },
    })) ??
    (await prisma.negotiation.create({
      data: {
        quotationId: quotation.id,
        customerId: quotation.customerId,
        startedAt: now,
      },
    }));

  const request = await prisma.negotiationRequest.create({
    data: {
      negotiationId: negotiation.id,
      quotationLineId: params.lineId ?? null,
      requestType: params.requestType,
      requestedValue:
        params.requestedValue !== null && params.requestedValue !== undefined
          ? new Decimal(params.requestedValue)
          : null,
      reason: params.reason ?? null,
      createdAt: now,
    },
  });

  if (params.requestType !== "COUNTER_DISCOUNT") {
    // A question or a comment changes no commercial term, so nothing is
    // re-evaluated and no approval is disturbed.
    if (params.reason) {
      await prisma.negotiationComment.create({
        data: {
          negotiationId: negotiation.id,
          quotationLineId: params.lineId ?? null,
          authorId: user.id,
          message: params.reason,
          createdAt: now,
        },
      });
    }
    await prisma.quotation.update({
      where: { id: quotation.id },
      data: { portalStatus: "UNDER_NEGOTIATION", lastActivityAt: now, updatedAt: now },
    });
    await appendAudit({
      entityName: "Quotation",
      entityId: quotation.id,
      action: "NEGOTIATE",
      actorId: user.id,
      reason: `Customer ${params.requestType.toLowerCase()} on the portal`,
      fieldChanges: { requestId: request.id },
    });
    return { status: 200, outcome: "SUBMITTED", requestId: request.id, whatIf: null };
  }

  // --- Counter-discount: apply, recompute, then judge -----------------------
  const snapshot = await lastApprovedSnapshot(quotation.id);
  const approvedApprovers = await approversOnRecord(quotation.id);

  await prisma.quotationLine.update({
    where: { id: params.lineId as string },
    data: { discountPercentage: new Decimal(params.requestedValue as string), updatedAt: now },
  });
  const recomputed = await recomputeQuotation(quotation.id);

  const proposedLines = await currentLineTerms(quotation.id);
  const chain = await loadActiveApprovalSteps();
  const proposedRoute = resolveApprovalRoute({
    steps: chain,
    score: recomputed.riskScore,
    anyLineOverCeiling: proposedLines.some((l) =>
      new Decimal(l.discountPercentage).greaterThan(new Decimal(l.discountCeiling)),
    ),
    maxLineDiscount: proposedLines.reduce(
      (acc, l) => Decimal.max(acc, new Decimal(l.discountPercentage)),
      new Decimal(0),
    ),
  });

  const whatIf = evaluateWhatIf({
    // With nothing ever approved, every term is new, so the empty snapshot
    // correctly reads as "beyond what was approved".
    approvedLines: snapshot?.lines ?? [],
    proposedLines,
    approvedScore: snapshot?.riskScore ?? 0,
    proposedScore: recomputed.riskScore,
    approvedApprovers,
    proposedApprovers: proposedRoute.steps.map((s) => s.approverRole),
  });

  await snapshotQuotation({
    quotationId: quotation.id,
    reason: `Customer counter-discount on ${params.lineId}`,
    createdById: user.id,
  });

  const outcome: NegotiationOutcome = whatIf.requiresReapproval
    ? "ACCEPTED_PENDING_APPROVAL"
    : "ACCEPTED_NO_REAPPROVAL";

  await prisma.negotiationRequest.update({
    where: { id: request.id },
    data: { status: outcome, resolvedAt: now },
  });

  await prisma.quotation.update({
    where: { id: quotation.id },
    data: {
      portalStatus: "UNDER_NEGOTIATION",
      negotiationCount: { increment: 1 },
      lastActivityAt: now,
      updatedAt: now,
    },
  });

  // Rescore before routing, not after.
  //
  // The what-if above deliberately ran on the pre-increment count: the round
  // was still in progress, and 03_BUSINESS_RULES.md counts *completed* rounds.
  // The round is now complete, so the stored score has to include it - and it
  // has to be stored before an approval request is raised, because
  // submitForApproval stamps the request with whatever score the quotation
  // carries at that moment. Doing this afterwards left a reviewer looking at a
  // request marked 25 pointing at a quote reading 30.
  const rescored = await recomputeQuotation(quotation.id);

  if (whatIf.requiresReapproval) {
    // Forced, because the what-if has already decided. Routing alone could say
    // "not required" for a small increase, and that would let a customer edge a
    // quote past its approved terms one request at a time.
    await submitForApproval({
      quotationId: quotation.id,
      actorId: user.id,
      forceApproval: true,
      triggerReason: whatIf.reason,
    });
  }

  await appendAudit({
    entityName: "Quotation",
    entityId: quotation.id,
    action: "NEGOTIATE",
    actorId: user.id,
    reason: whatIf.reason,
    fieldChanges: {
      requestId: request.id,
      lineId: params.lineId,
      requestedDiscount: String(params.requestedValue),
      outcome,
      scoreDelta: whatIf.scoreDelta,
      worsenedLines: whatIf.worsenedLines,
      riskScoreAfter: rescored.riskScore,
    },
  });

  return { status: 200, outcome, requestId: request.id, whatIf };
}

/** Terms as they stand right now, in the shape the what-if expects. */
async function currentLineTerms(quotationId: string): Promise<LineTerms[]> {
  const lines = await prisma.quotationLine.findMany({
    where: { quotationId },
    orderBy: { sequence: "asc" },
    include: { product: { select: { name: true } } },
  });
  return lines.map((l) => ({
    lineId: l.id,
    label: l.product.name,
    discountPercentage: l.discountPercentage,
    discountCeiling: l.discountCeiling,
  }));
}

/** Approvers who have actually signed this quotation off. */
async function approversOnRecord(quotationId: string): Promise<Role[]> {
  const approved = await prisma.approvalRequest.findMany({
    where: { quotationId, status: "APPROVED" },
    include: { step: { select: { approverRole: true } } },
  });
  return [...new Set(approved.map((a) => a.step.approverRole))];
}

// ---------------------------------------------------------------------------
// Confirmation
// ---------------------------------------------------------------------------

export type ConfirmResult =
  | { status: 200; orderStatus: string }
  | { status: 401 | 403 | 404 }
  | { status: 409; reason: "pending_approval" | "already_confirmed"; message: string };

/**
 * POST /my/quotations/:id/confirm
 *
 * The approval state is re-checked here, server-side, every time. A customer
 * may have had the page open since before a negotiation pushed the quote back
 * into review; confirming on that stale view would produce an order nobody
 * approved. 409 tells them the terms moved, rather than quietly succeeding.
 */
export async function confirmPortalQuotation(params: {
  user: AuthzUser | null;
  quotationId: string;
}): Promise<ConfirmResult> {
  const loaded = await loadForPortal(params.user, params.quotationId);
  if (loaded.status !== 200) return { status: loaded.status };

  const user = params.user as AuthzUser;
  const quotation = loaded.quotation;

  if (quotation.status === "CONFIRMED") {
    return {
      status: 409,
      reason: "already_confirmed",
      message: "This quotation has already been confirmed.",
    };
  }

  // Re-read rather than trusting the loaded copy: the gap between load and
  // click is exactly where a re-approval lands.
  const fresh = await prisma.quotation.findUniqueOrThrow({
    where: { id: quotation.id },
    select: { approvalState: true },
  });

  if (fresh.approvalState !== "APPROVED") {
    return {
      status: 409,
      reason: "pending_approval",
      message:
        "These terms changed and are being reviewed by the seller. Please review the updated quotation.",
    };
  }

  const now = currentBusinessTime();

  await prisma.$transaction(async (tx) => {
    await tx.negotiation.updateMany({
      where: { quotationId: quotation.id, status: "OPEN" },
      data: { status: "CLOSED", closedAt: now },
    });
    await tx.quotation.update({
      where: { id: quotation.id },
      data: {
        status: "CONFIRMED",
        portalStatus: "CONFIRMED",
        confirmedAt: now,
        lastActivityAt: now,
        updatedAt: now,
      },
    });
  });

  await appendAudit({
    entityName: "Quotation",
    entityId: quotation.id,
    action: "CONFIRM",
    actorId: user.id,
    reason: "Confirmed by the customer in the portal",
    fieldChanges: { status: { before: quotation.status, after: "CONFIRMED" } },
  });

  return { status: 200, orderStatus: "CONFIRMED" };
}

/** Internal view of the negotiation thread, for the rep and the approver. */
export async function getNegotiationHistory(quotationId: string) {
  const negotiations = await prisma.negotiation.findMany({
    where: { quotationId },
    include: {
      requests: { orderBy: { createdAt: "asc" } },
      comments: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { startedAt: "asc" },
  });
  if (negotiations.length === 0) {
    const exists = await prisma.quotation.count({ where: { id: quotationId } });
    if (exists === 0) throw new NotFoundError(`Quotation ${quotationId} does not exist`);
  }
  return negotiations;
}

/** Guard used by tests and by any caller building a portal response by hand. */
export function assertNoInternalFields(payload: unknown): void {
  const forbidden = [
    "cost",
    "unitCost",
    "margin",
    "marginAmount",
    "marginPercentage",
    "grossMargin",
    "riskScore",
    "riskLevel",
    "approvalState",
    "discountCeiling",
    "violationPoints",
    "totalCost",
  ];
  const serialised = JSON.stringify(payload);
  for (const field of forbidden) {
    if (serialised.includes(`"${field}"`)) {
      throw new ValidationError(`Portal payload leaked the internal field ${field}.`, field);
    }
  }
}
