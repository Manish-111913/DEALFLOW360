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
import { isPendingApproval } from "../domain/approval";
import { ADVISORY_LOCK, lockKeyFor } from "../locks";
import { publishDealEvent } from "../realtime/events";
import { loadActiveApprovalSteps, submitForApproval } from "./approvals";
import { hasFulfillmentPlan, planFulfillment } from "./fulfillment";
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

/**
 * The words a customer is allowed to see for a deal's state (§11).
 *
 * Deliberately fewer than the internal machine has. `PENDING_MANAGER` and
 * `PENDING_FINANCE` both collapse to "Under Review": which desk a quote is
 * sitting on, and therefore how the seller's approval chain is built, is not
 * the customer's business.
 */
/**
 * How long two identical requests are treated as one submission.
 *
 * Long enough to absorb a double click or a retried POST, short enough that a
 * customer who reconsiders and asks the same thing again is heard.
 */
const DUPLICATE_WINDOW_MS = 15_000;

export type PortalStatus =
  | "Sent"
  | "Under Negotiation"
  | "Under Review"
  | "Ready to Confirm"
  | "Confirmed";

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
  /**
   * The version the customer is looking at. Sent back on confirm so the server
   * can refuse a confirmation of terms that have since moved (§13).
   */
  version: string;
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
function portalStatusFor(quotation: {
  status: string;
  approvalState: string;
  negotiations: { status: string }[];
}): PortalStatus {
  if (quotation.status === "CONFIRMED") return "Confirmed";

  // Order matters. A quote sitting in approval is "Under Review" whether or not
  // a negotiation is what put it there - the customer's question is "is anyone
  // waiting on me?", and while it is in review the answer is no.
  if (quotation.approvalState === "PENDING_MANAGER" || quotation.approvalState === "PENDING_FINANCE") {
    return "Under Review";
  }
  if (quotation.negotiations.some((n) => n.status === "OPEN")) return "Under Negotiation";
  if (quotation.approvalState === "APPROVED") return "Ready to Confirm";
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
    version: versionOf(quotation),
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
// GET /my/quotations — the customer's own list
// ---------------------------------------------------------------------------

/** One row on the customer's My Quotations screen. Customer-safe by shape. */
export interface PortalQuotationSummary {
  id: string;
  quoteNumber: string;
  status: PortalStatus;
  currency: string;
  totalAmount: string;
  validUntil: string | null;
  lastUpdated: string;
  itemCount: number;
  /** The customer's own product names, for the "deliverable scope" column. */
  productNames: string[];
  /** True while the seller still owes the customer an answer. */
  awaitingSellerReview: boolean;
  /** Optimistic-concurrency token; see `confirmPortalQuotation`. */
  version: string;
}

/**
 * Every quotation this customer has been shown.
 *
 * Scoped by `scopeFor`, so a portal identity sees only its own customer's rows -
 * and filtered to those actually shared, because a quote the seller is still
 * drafting is not the customer's to know about.
 *
 * Note what the row does not carry: no margin, no cost, no risk, no approval
 * chain. This is a projection, not a filtered internal row, so a field added to
 * Quotation later cannot leak here by default (D20).
 */
export async function listMyQuotations(
  user: AuthzUser | null,
): Promise<{ status: 200; quotations: PortalQuotationSummary[] } | { status: 401 | 403 }> {
  if (!user) return { status: 401 };
  if (user.kind !== "PORTAL") return { status: 403 };

  const scope = scopeFor(user, "Quotation");
  const rows = await prisma.quotation.findMany({
    where: { AND: [{ portalStatus: { not: "NOT_SHARED" } }, scope] },
    orderBy: { lastActivityAt: "desc" },
    take: 100,
    include: {
      lines: { include: { product: { select: { name: true } } }, orderBy: { sequence: "asc" } },
      negotiations: { select: { status: true } },
    },
  });

  return {
    status: 200,
    quotations: rows.map((q) => ({
      id: q.id,
      quoteNumber: q.quoteNumber,
      status: portalStatusFor(q),
      currency: q.currency ?? "INR",
      totalAmount: q.totalAmount.toFixed(2),
      validUntil: q.validUntil?.toISOString() ?? null,
      lastUpdated: q.lastActivityAt.toISOString(),
      itemCount: q.lines.length,
      productNames: q.lines.map((line) => line.product.name),
      awaitingSellerReview:
        q.negotiations.some((n) => n.status === "OPEN") && q.approvalState !== "APPROVED",
      version: versionOf(q),
    })),
  };
}

/**
 * The optimistic-concurrency token for a quotation (§13).
 *
 * `updatedAt` alone is not enough: an approval decision moves `lastActivityAt`
 * without necessarily touching `updatedAt`, and confirming against terms that
 * were approved after the customer loaded the page is exactly the case this
 * guards. Both timestamps together identify the version the customer saw.
 */
export function versionOf(quotation: { updatedAt: Date; lastActivityAt: Date }): string {
  return `${quotation.updatedAt.getTime()}.${quotation.lastActivityAt.getTime()}`;
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

  const requestedDecimal =
    params.requestedValue !== null && params.requestedValue !== undefined
      ? new Decimal(params.requestedValue)
      : null;

  // Duplicate-submission guard (§21).
  //
  // A double-clicked "Submit Counter Offer" used to create two requests, and
  // that is not merely untidy: each counter increments `negotiationCount`, and
  // the risk engine scores repeated negotiation. Two clicks therefore made the
  // deal look riskier than it is and could push it over an approval band on
  // their own.
  //
  // Matching on content within a short window rather than on a client-supplied
  // key, because the same ask repeated seconds apart is the same ask however it
  // reached us - a retried request, a double click, or an impatient customer.
  // A genuine second thought minutes later is a different request and is
  // recorded as one.
  //
  // Checked and inserted inside one transaction holding a per-quotation
  // advisory lock. Without the lock this is a read-then-write race that a
  // double click wins: both requests find no duplicate, both insert, and the
  // negotiation count rises by two. The lock is keyed on the quotation, so
  // customers negotiating different deals never wait on each other.
  const duplicateWindowStart = new Date(now.getTime() - DUPLICATE_WINDOW_MS);

  const claim = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK.negotiationSubmit}, ${lockKeyFor(quotation.id)})`;

    // The thread is resolved inside the lock too. It has to be: two concurrent
    // submissions both finding no open negotiation would each create one, and
    // the duplicate check below - which is scoped to a thread - would then be
    // looking in two different places and find nothing either time.
    const negotiation =
      (await tx.negotiation.findFirst({
        where: { quotationId: quotation.id, status: "OPEN" },
      })) ??
      (await tx.negotiation.create({
        data: {
          quotationId: quotation.id,
          customerId: quotation.customerId,
          startedAt: now,
        },
      }));

    const existing = await tx.negotiationRequest.findFirst({
      where: {
        negotiationId: negotiation.id,
        requestType: params.requestType,
        quotationLineId: params.lineId ?? null,
        requestedValue: requestedDecimal,
        createdAt: { gte: duplicateWindowStart },
      },
      orderBy: { createdAt: "desc" },
    });
    if (existing) return { duplicate: true as const, row: existing, negotiation };

    const created = await tx.negotiationRequest.create({
      data: {
        negotiationId: negotiation.id,
        quotationLineId: params.lineId ?? null,
        requestType: params.requestType,
        requestedValue: requestedDecimal,
        reason: params.reason ?? null,
        createdAt: now,
      },
    });
    return { duplicate: false as const, row: created, negotiation };
  });

  const negotiation = claim.negotiation;
  const duplicate = claim.duplicate ? claim.row : null;

  if (duplicate) {
    // Report what the original submission produced, so the caller cannot tell
    // a de-duplicated retry from the first attempt.
    const quotationNow = await prisma.quotation.findUniqueOrThrow({
      where: { id: quotation.id },
      select: { approvalState: true },
    });
    return {
      status: 200,
      outcome:
        params.requestType !== "COUNTER_DISCOUNT"
          ? "SUBMITTED"
          : isPendingApproval(quotationNow.approvalState)
            ? "ACCEPTED_PENDING_APPROVAL"
            : "ACCEPTED_NO_REAPPROVAL",
      requestId: duplicate.id,
      whatIf: null,
    };
  }

  const request = claim.row;

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
    await publishDealEvent({
      type: "NEGOTIATION_SUBMITTED",
      quotationId: quotation.id,
      customerId: quotation.customerId,
      salesRepId: quotation.salesRepId,
      at: now.getTime(),
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

  // A quote already sitting in someone's queue must not be submitted again.
  // `submitForApproval` refuses that with a ConflictError, which used to escape
  // as a 500 whenever a customer countered while their quote was still under
  // review - a completely ordinary thing for a customer to do. There is nothing
  // to submit in that case: the request is recorded, the score has just been
  // recomputed, and the reviewer picks up the revised figures when they open it.
  //
  // Re-read rather than reusing the copy loaded at the top of this function:
  // `recomputeQuotation` previews the approval requirement but never
  // transitions it, so the stored state is the authority on whether a request
  // is already open.
  const current = await prisma.quotation.findUniqueOrThrow({
    where: { id: quotation.id },
    select: { approvalState: true },
  });
  const alreadyQueued = isPendingApproval(current.approvalState);

  if (whatIf.requiresReapproval && !alreadyQueued) {
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

  // Published after the transaction rather than inside it: the work above spans
  // several of them (recompute, then possibly submitForApproval), so there is
  // no single transaction to ride on, and by here every one of them is
  // committed. Announcing a state that is already true is the safe direction.
  await publishDealEvent({
    type: outcome === "ACCEPTED_PENDING_APPROVAL" ? "APPROVAL_REQUIRED" : "NEGOTIATION_SUBMITTED",
    quotationId: quotation.id,
    customerId: quotation.customerId,
    salesRepId: quotation.salesRepId,
    at: now.getTime(),
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
  | { status: 409; reason: "pending_approval" | "already_confirmed" | "stale"; message: string };

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
  /**
   * The version the customer had on screen. Optional so existing callers keep
   * working, but the portal always sends it - without it, a customer can
   * confirm terms they never saw.
   */
  expectedVersion?: string | null;
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
    select: { approvalState: true, updatedAt: true, lastActivityAt: true },
  });

  // Optimistic concurrency (§13). The approval check below catches the common
  // case, but not every change is an approval change: a rep can revise a price
  // on an already-approved quote, and confirming the figures the customer had
  // on screen would then agree to something else entirely.
  if (params.expectedVersion && params.expectedVersion !== versionOf(fresh)) {
    return {
      status: 409,
      reason: "stale",
      message: "This quote just changed - please review the updated terms before confirming.",
    };
  }

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

    // Announced inside the transaction, so the internal side never hears about
    // a confirmation that then rolled back.
    await publishDealEvent(
      {
        type: "QUOTE_CONFIRMED",
        quotationId: quotation.id,
        customerId: quotation.customerId,
        salesRepId: quotation.salesRepId,
        at: now.getTime(),
      },
      tx,
    );
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

  /**
   * A confirmed order is one somebody now has to ship, so this is the moment it
   * earns a plan. Until this existed, an order confirmed in the portal arrived
   * on the fulfilment screen with nothing on it, because the only other caller
   * of the planner refuses to run unless a plan is already there.
   *
   * Outside the transaction and deliberately non-fatal: the customer has
   * confirmed, and that is true whether or not we managed to work out which
   * depot ships it. Operations can produce the plan on the screen instead.
   */
  if (!(await hasFulfillmentPlan(quotation.id))) {
    try {
      await planFulfillment(quotation.id);
    } catch {
      // Left unplanned; the fulfilment screen offers the same action by hand.
    }
  }

  return { status: 200, orderStatus: "CONFIRMED" };
}

/** Internal view of the negotiation thread, for the rep and the approver. */
export async function getNegotiationHistory(quotationId: string) {
  const negotiations = await prisma.negotiation.findMany({
    where: { quotationId },
    include: {
      requests: { orderBy: { createdAt: "asc" } },
      comments: {
        orderBy: { createdAt: "asc" },
        // Which SIDE said it, not merely who. A portal comment carries the
        // buyer's own user id, so "authorId is null" does not mean "from the
        // customer" - and a caller that assumed it did was labelling the
        // customer's own words as the seller's when it summarised the thread.
        include: { author: { select: { kind: true, name: true } } },
      },
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
