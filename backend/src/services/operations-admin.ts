import { Prisma } from "../generated/prisma/client";
import type { CustomerTier } from "../generated/prisma/enums";
import { appendAudit } from "../audit";
import { assertCan, type AuthzUser } from "../authz/roles";
import { isDenyAll, scopeFor } from "../authz/scope";
import { prisma } from "../db";
import { isPendingApproval } from "../domain/approval";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { setCustomerTier } from "./customers";
import { getHealthHistory, recomputeAllDealHealth } from "./deal-health";
import {
  consolidateBackorder,
  findConsolidatableBackorders,
  receiveStock,
  type ConsolidationCandidate,
} from "./fulfillment";
import { versionHistory, type LineSnapshot } from "./quotation-versions";
import { assertQuotationVisible } from "./quotations";
import {
  acceptUpsell,
  dismissUpsell,
  refreshCoPurchaseRates,
  type RefreshResult,
} from "./upsell";

/**
 * The operations the product could not reach.
 *
 * Every primitive wrapped here already existed and already worked; none of them
 * had a caller that knew who was asking. Stock could only be received by the
 * seed, a backorder could only be consolidated from a test, deal health could
 * only be recomputed by a script, a customer's tier could only be moved with
 * SQL, and the version history that exists so a re-approving manager can be
 * shown a real diff was written by every negotiation and read by nobody.
 *
 * As in `dispatch.ts` and `payments.ts`, the primitives keep their signatures -
 * the seed and the fulfilment tests compose them directly - and this is the
 * layer the product uses instead. Every function here answers both
 * authorisation questions before it calls one: `assertCan` for "may this role
 * do this at all", and the row scope for "to which records". Where a primitive
 * already writes its own audit entry the call site says so and does not write a
 * second one; a duplicate row in a hash-chained log is not a stronger trail,
 * only a confusing one.
 */

// ---------------------------------------------------------------------------
// Row scope, for the lists that are assembled rather than queried
// ---------------------------------------------------------------------------

/**
 * Narrow consolidation candidates to the deals this caller could actually open.
 *
 * `findConsolidatableBackorders` answers a warehouse question - "what can this
 * depot now cover" - and to answer it, it reads every open backorder in the
 * database along with its quote number. That is the right shape for the
 * primitive and the wrong shape to hand to a person. Finance/Operations holds
 * `allocate`, but its row scope is by approval stage rather than by ownership,
 * so an unfiltered list would name deals the very same user is told do not
 * exist the moment they click one.
 *
 * Filtered afterwards rather than by composing the scope into the primitive's
 * own query, deliberately: its "tentatively spoken for" arithmetic has to see
 * every backorder competing for the same units, or two callers would each be
 * told the last box on the shelf is theirs.
 */
async function visibleCandidates(
  user: AuthzUser,
  candidates: ConsolidationCandidate[],
): Promise<ConsolidationCandidate[]> {
  if (candidates.length === 0) return [];

  const scope = scopeFor(user, "Quotation");
  if (isDenyAll(scope)) return [];

  const visible = await prisma.quotation.findMany({
    where: {
      AND: [
        { id: { in: [...new Set(candidates.map((c) => c.quotationId))] } },
        scope as Prisma.QuotationWhereInput,
      ],
    },
    select: { id: true },
  });

  const allowed = new Set(visible.map((q) => q.id));
  return candidates.filter((c) => allowed.has(c.quotationId));
}

/** Active depots, best configured priority first. A4: never a hardcoded order. */
async function activeWarehouses(): Promise<{ id: string; name: string }[]> {
  return prisma.warehouse.findMany({
    where: { isActive: true },
    orderBy: { priority: "asc" },
    select: { id: true, name: true },
  });
}

// ---------------------------------------------------------------------------
// Stock receipt and backorder consolidation (D17: Finance/Operations)
// ---------------------------------------------------------------------------

export interface StockReceipt {
  warehouseId: string;
  productId: string;
  /** Omitted for a product that is not sold by variant. */
  variantId?: string | null;
  quantity: number;
}

export interface StockReceiptResult {
  /** Units at that depot after the receipt, reserved ones included. */
  available: number;
  /** §B6's prompt: what this delivery unblocked, scoped to the caller. */
  consolidatable: ConsolidationCandidate[];
}

/**
 * Record a delivery into a warehouse.
 *
 * D17 puts fulfilment in Finance/Operations' hands and leaves the rep with
 * visibility only, so `allocate` is the capability: a receipt moves the numbers
 * every later allocation is planned against, which is the same authority as
 * deciding where an order ships from.
 *
 * There is no row to scope - stock belongs to a depot, not to a deal - so the
 * second question is asked of the answer rather than the request, by filtering
 * the backorders this receipt has just unblocked.
 */
export async function receiveStockAs(
  user: AuthzUser,
  input: StockReceipt,
): Promise<StockReceiptResult> {
  assertCan(user, "allocate");

  // The primitive refuses a non-positive quantity; it does not refuse 2.5,
  // which would put a fractional box on a shelf that counts whole ones.
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new ValidationError(
      "Received quantity must be a whole number of at least 1.",
      "quantity",
    );
  }

  const warehouse = await prisma.warehouse.findUnique({
    where: { id: input.warehouseId },
    select: { id: true, name: true, isActive: true },
  });
  if (!warehouse) throw new NotFoundError(`Warehouse ${input.warehouseId} does not exist`);

  // The allocator only ever looks at active depots, so units received into a
  // retired one are invisible to every plan that follows - a silent write of
  // stock nobody can sell. Better to say the depot is closed.
  if (!warehouse.isActive) {
    throw new ConflictError(`${warehouse.name} is not an active warehouse.`);
  }

  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    select: { id: true },
  });
  if (!product) throw new NotFoundError(`Product ${input.productId} does not exist`);

  const variantId = input.variantId ?? null;
  if (variantId !== null) {
    // Stock is keyed on (warehouse, product, variant), so a variant belonging to
    // some other product would create a row no demand line ever matches: the
    // receipt would appear to work and unblock nothing, permanently.
    const variant = await prisma.productVariant.findFirst({
      where: { id: variantId, productId: input.productId },
      select: { id: true },
    });
    if (!variant) {
      throw new ValidationError("That variant does not belong to this product.", "variantId");
    }
  }

  // `receiveStock` writes its own WarehouseStock audit entry and takes the actor
  // for it, so nothing is appended here.
  const result = await receiveStock({
    warehouseId: input.warehouseId,
    productId: input.productId,
    variantId,
    quantity: input.quantity,
    actorId: user.id,
  });

  return {
    available: result.available,
    consolidatable: await visibleCandidates(user, result.consolidatable),
  };
}

/**
 * Every backorder some depot can now cover in full.
 *
 * The primitive asks the question one warehouse at a time, because coverage is
 * a property of a shelf rather than of the backorder. This asks it of each
 * active depot and returns the union, so a backorder two warehouses can both
 * cover appears twice - once per depot. That is the choice being offered, not a
 * duplicate row: consolidating is deciding where the remainder ships from.
 */
export async function listConsolidatableBackordersAs(
  user: AuthzUser,
): Promise<ConsolidationCandidate[]> {
  assertCan(user, "allocate");

  const candidates: ConsolidationCandidate[] = [];
  for (const warehouse of await activeWarehouses()) {
    candidates.push(...(await findConsolidatableBackorders(warehouse.id)));
  }

  return visibleCandidates(user, candidates);
}

export interface ConsolidationResult {
  quotationId: string;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
}

/**
 * Fulfil one backorder from stock that has since arrived.
 *
 * The caller names a backorder and not a depot, because from the screen this is
 * a single decision: "yes, consolidate it". The warehouse is then resolved the
 * way the list resolves it - the first active depot, in configured priority
 * order, that can cover the whole quantity. Partial coverage is offered nowhere
 * in this flow: turning one late shipment into two is the problem, not the fix.
 */
export async function consolidateBackorderAs(
  user: AuthzUser,
  backorderId: string,
): Promise<ConsolidationResult> {
  // `consolidateBackorder` asks this too, but it asks it after this wrapper has
  // already looked the backorder up. Asking first means a caller holding no
  // `allocate` cannot use the difference between "not found" and "forbidden" to
  // learn which backorder ids are real.
  assertCan(user, "allocate");

  const backorder = await prisma.backorder.findUnique({
    where: { id: backorderId },
    select: { id: true, status: true, quantity: true, quotationId: true },
  });
  if (!backorder) throw new NotFoundError(`Backorder ${backorderId} does not exist`);

  // The row question. Not found rather than forbidden, as everywhere else: that
  // the backorder exists is itself a fact about someone else's deal.
  await assertQuotationVisible(user, backorder.quotationId);

  if (backorder.status !== "OPEN") {
    throw new ConflictError("This backorder is no longer open.");
  }

  let chosen: { id: string; name: string } | null = null;
  for (const warehouse of await activeWarehouses()) {
    const candidates = await findConsolidatableBackorders(warehouse.id);
    if (candidates.some((candidate) => candidate.backorderId === backorderId)) {
      chosen = warehouse;
      break;
    }
  }

  // Conflict rather than validation: nothing about the request is wrong, the
  // stock has simply not arrived. This button is offered off a list that was
  // true a moment ago, so losing that race is an expected outcome, not a bug.
  if (!chosen) {
    throw new ConflictError("No warehouse can cover this backorder in full yet.");
  }

  // `consolidateBackorder` audits the reservation against the quotation, so
  // there is no second entry here.
  await consolidateBackorder({ backorderId, warehouseId: chosen.id, user });

  return {
    quotationId: backorder.quotationId,
    warehouseId: chosen.id,
    warehouseName: chosen.name,
    quantity: backorder.quantity,
  };
}

// ---------------------------------------------------------------------------
// Deal health
// ---------------------------------------------------------------------------

/**
 * Re-score every live deal.
 *
 * The capability is the interesting decision here, so it is argued rather than
 * assumed. `recomputeAllDealHealth` looks like a read - it recomputes a number -
 * and it is not one: each pass appends a snapshot per live deal and can raise an
 * alert, and raising an alert is exactly what `escalateDeal` does one deal at a
 * time under `escalate`. `view dealHealth` is the capability for looking at the
 * board; it must not also be the capability for writing to it, or every reader
 * would silently be an author - which is the bug `scoreDealHealth`'s
 * `persist: false` option was added to fix.
 *
 * So both are asserted and each says something different: `view dealHealth`
 * because this is the health surface, `escalate` because pressing it produces
 * alerts somebody then has to act on. The intersection is the Sales Manager,
 * whose board this is.
 *
 * No row scope is applied, and that is intended rather than forgotten: the job
 * is deliberately the whole book, exactly like `runBillingAs`. What the caller
 * may then *read* of the result is still scoped, by the dashboard.
 */
export async function recomputeDealHealthAs(user: AuthzUser): Promise<{ scored: number }> {
  assertCan(user, "view", "dealHealth");
  assertCan(user, "escalate");

  const result = await recomputeAllDealHealth();

  // The primitive audits nothing - it was written as the body of a cron, and a
  // cron has no actor. Pressed as a button it has one, and a batch that can
  // raise alerts across the whole book should record who set it going.
  await appendAudit({
    entityName: "DealHealthSnapshot",
    entityId: "all",
    action: "UPDATE",
    actorId: user.id,
    reason: "Deal health recomputed across every live deal",
    fieldChanges: { scored: result.scored },
  });

  return result;
}

/** One point on a deal's health trend. */
export interface HealthHistoryPoint {
  snapshotId: string;
  healthScore: number;
  severity: string;
  /** A Decimal in the database; a string by the time it leaves the service. */
  riskScore: string;
  recommendedAction: string;
  stalledDays: number;
  negotiationCount: number;
  penalties: {
    stalled: number;
    approvalDelay: number;
    negotiation: number;
    delivery: number;
    discountAnomaly: number;
  };
  computedAt: string;
}

/**
 * The trend behind one deal's health score, oldest first.
 *
 * Two gates, and both earn their place: `view dealHealth` keeps this off the
 * Sales Rep's screen as the matrix says, and the visibility check keeps a
 * manager out of the other team's deals. A single score says a deal is bad; the
 * trend says it has been getting worse for a fortnight, which is the sentence a
 * manager can act on.
 */
export async function getHealthHistoryAs(
  user: AuthzUser,
  quotationId: string,
): Promise<HealthHistoryPoint[]> {
  assertCan(user, "view", "dealHealth");
  await assertQuotationVisible(user, quotationId);

  const snapshots = await getHealthHistory(quotationId);

  return snapshots.map((snapshot) => ({
    snapshotId: snapshot.id,
    healthScore: snapshot.healthScore,
    severity: snapshot.severity,
    riskScore: snapshot.riskScore.toFixed(2),
    recommendedAction: snapshot.recommendedAction,
    stalledDays: snapshot.stalledDays,
    negotiationCount: snapshot.negotiationCount,
    penalties: {
      stalled: snapshot.stalledPenalty,
      approvalDelay: snapshot.approvalDelayPenalty,
      negotiation: snapshot.negotiationPenalty,
      delivery: snapshot.deliveryPenalty,
      discountAnomaly: snapshot.discountAnomalyPenalty,
    },
    computedAt: snapshot.computedAt.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Customer tier
// ---------------------------------------------------------------------------

export interface TierChange {
  customerId: string;
  tier: CustomerTier;
  /** Required. The audit entry is much of why this goes through a wrapper. */
  reason: string;
}

/**
 * Move a customer between tiers.
 *
 * Who may do this is not obvious from the matrix, which has no `customer`
 * subject - so the honest question is what a tier change *is*. It is not a
 * contact-record edit. The tier is what a discount ceiling is resolved from, so
 * moving an account from SILVER to GOLD silently raises the ceiling every open
 * quotation for that customer is checked against, and quietly removes the
 * approval step some of them would otherwise have tripped. That is the lever
 * `setTierCeiling` pulls, applied to one account instead of one tier, so it is
 * gated on the same capability: `configure discountTier`, which D16 gives the
 * Sales Manager alongside the Admin.
 *
 * What that excludes is the point. A Sales Rep may update their own quotations
 * and may create accounts, and may not do this - otherwise a rep who wanted a
 * deeper discount could promote their own customer to GOLD and clear their own
 * way, with every ceiling check downstream passing honestly against a number
 * the rep chose.
 */
export async function setCustomerTierAs(user: AuthzUser, input: TierChange) {
  assertCan(user, "configure", "discountTier");

  const reason = input.reason.trim();
  if (!reason) {
    throw new ValidationError(
      "A tier change needs a reason - it moves the discount ceiling for every open quote on this account.",
      "reason",
    );
  }

  // The row question. Customer scope is unrestricted for internal roles today,
  // but it is composed into the query rather than assumed, so the day that stops
  // being true this call does not quietly become the exception.
  const scope = scopeFor(user, "Customer");
  const customer = await prisma.customer.findFirst({
    where: { AND: [{ id: input.customerId }, scope] },
    select: { id: true, name: true, tier: true },
  });
  if (!customer) throw new NotFoundError(`Customer ${input.customerId} does not exist`);

  // A no-op would otherwise append an audit entry claiming a governance change
  // that did not happen, and a trail full of those is a trail nobody reads.
  if (customer.tier === input.tier) {
    throw new ConflictError(`${customer.name} is already on the ${input.tier} tier.`);
  }

  // `setCustomerTier` appends the before/after entry itself and takes both the
  // actor and the reason for it, which is why the reason is mandatory up here.
  // Nothing further is appended.
  return setCustomerTier({
    customerId: input.customerId,
    tier: input.tier,
    actorId: user.id,
    reason,
  });
}

// ---------------------------------------------------------------------------
// Upsell
// ---------------------------------------------------------------------------

/**
 * Recompute co-purchase rates from confirmed order history (D14).
 *
 * `configure upsellRule` is the capability the matrix already names for the
 * pairing table, and this writes to exactly that table. It lands on the Admin
 * rather than the Sales Manager, which is right: a derived rate is a fact about
 * the whole order book, not a policy about one team's discounting.
 *
 * Nothing is scoped, because nothing here is per-deal - the input is every
 * confirmed order there has ever been.
 */
export async function refreshUpsellRatesAs(user: AuthzUser): Promise<RefreshResult> {
  assertCan(user, "configure", "upsellRule");

  // The primitive audits its own write and takes the actor for it. It stays
  // silent when it wrote nothing, which is the right silence: a run that moved
  // no rate is not a configuration change.
  return refreshCoPurchaseRates(user.id);
}

/**
 * Resolve a recommendation to its deal, with the caller checked against it.
 *
 * Accept and dismiss both arrive as a recommendation id, because that is what
 * the suggestion list hands back, while the primitives are addressed by
 * (quotation, product) - the pair a recommendation is about. Turning one into
 * the other is also where the row question gets asked, so both paths ask it.
 */
async function loadRecommendation(user: AuthzUser, recommendationId: string) {
  assertCan(user, "update");

  const recommendation = await prisma.upsellRecommendation.findUnique({
    where: { id: recommendationId },
    select: {
      id: true,
      status: true,
      quotationId: true,
      productId: true,
      product: { select: { name: true } },
    },
  });
  if (!recommendation) {
    throw new NotFoundError(`Recommendation ${recommendationId} does not exist`);
  }

  await assertQuotationVisible(user, recommendation.quotationId);

  // Both primitives filter on SUGGESTED, so acting twice would otherwise report
  // success having changed nothing - and in the accept case would still have
  // added the line a second time.
  if (recommendation.status !== "SUGGESTED") {
    throw new ConflictError(
      `That suggestion has already been ${recommendation.status.toLowerCase()}.`,
    );
  }

  return recommendation;
}

/**
 * Accept a suggestion, which puts the product on the quotation.
 *
 * The state check is the one `quotation-authoring.ts` applies to every line
 * edit, for the same reason: accepting an upsell *is* a line edit wearing a
 * friendlier name. A quote that has been sent, or is sitting with an approver,
 * is not a working document, and slipping an extra product into it behind the
 * reviewer is what the approval step exists to prevent.
 */
export async function acceptUpsellAs(user: AuthzUser, recommendationId: string) {
  const recommendation = await loadRecommendation(user, recommendationId);

  const quotation = await prisma.quotation.findUnique({
    where: { id: recommendation.quotationId },
    select: { status: true, approvalState: true, quoteNumber: true },
  });
  if (!quotation) {
    throw new NotFoundError(`Quotation ${recommendation.quotationId} does not exist`);
  }
  if (quotation.status !== "DRAFT") {
    throw new ConflictError(
      `${quotation.quoteNumber} has been sent, so a suggestion can no longer be added to it.`,
    );
  }
  if (isPendingApproval(quotation.approvalState)) {
    throw new ConflictError(
      `${quotation.quoteNumber} is awaiting approval; adding to it now would change what the reviewer is looking at.`,
    );
  }

  // `acceptUpsell` goes through `addQuotationLine`, which audits the added line
  // against the quotation and runs the D21 recompute. No second entry.
  return acceptUpsell({
    quotationId: recommendation.quotationId,
    productId: recommendation.productId,
    actorId: user.id,
  });
}

/**
 * Turn a suggestion down.
 *
 * Allowed at any point in the quote's life, unlike accepting: closing a
 * suggestion changes nothing a reviewer or a customer is looking at. It only
 * stops the list offering it again.
 */
export async function dismissUpsellAs(user: AuthzUser, recommendationId: string): Promise<void> {
  const recommendation = await loadRecommendation(user, recommendationId);

  await dismissUpsell({
    quotationId: recommendation.quotationId,
    productId: recommendation.productId,
  });

  // `dismissUpsell` flips the status and writes nothing else - it was built as
  // the counterpart to accept, and accept is audited only by the line it adds.
  // The entry is worth having: which suggestions get declined, and by whom, is
  // how D14's claim that these are grounded in data gets judged after the fact.
  await appendAudit({
    entityName: "Quotation",
    entityId: recommendation.quotationId,
    action: "UPDATE",
    actorId: user.id,
    reason: `Upsell dismissed: ${recommendation.product.name}`,
    fieldChanges: {
      recommendationId: recommendation.id,
      productId: recommendation.productId,
      status: { before: "SUGGESTED", after: "DISMISSED" },
    },
  });
}

// ---------------------------------------------------------------------------
// Version history (D5)
// ---------------------------------------------------------------------------

export interface QuotationVersionRow {
  versionId: string;
  versionNumber: number;
  reason: string | null;
  createdByName: string | null;
  /** Money and percentages are Decimals in the database, strings from here on. */
  subtotal: string;
  discountAmount: string;
  totalAmount: string;
  totalCost: string;
  grossMargin: string;
  marginPercentage: string;
  riskScore: string;
  /** The lines exactly as they stood, so a diff needs no further query. */
  lines: LineSnapshot[];
  /** Set on the version a reviewer actually signed off. */
  approvedAt: string | null;
  createdAt: string;
}

/**
 * The full version history of a quotation, oldest first.
 *
 * `versionHistory` is the append-only trail D5 exists for, already written by
 * every negotiation, approval and revision - it simply had no authorised
 * reader, so the re-approval diff it was built for could not be put on a screen.
 *
 * `assertQuotationVisible` carries the `view quotation` check, so the assertion
 * above it is not that repeated. A version row is a complete internal snapshot:
 * total cost, gross margin, risk score. A portal identity holds `view
 * quotation` and can see its own deals, so visibility alone would let a buyer
 * read what their order costs us (D20). `view margin` is the capability that
 * names that data, every internal role holds it and no portal user does, which
 * makes it the right gate rather than a hand-written check on user kind.
 */
export async function listQuotationVersionsAs(
  user: AuthzUser,
  quotationId: string,
): Promise<QuotationVersionRow[]> {
  assertCan(user, "view", "margin");
  await assertQuotationVisible(user, quotationId);

  const versions = await versionHistory(quotationId);

  return versions.map((version) => ({
    versionId: version.id,
    versionNumber: version.versionNumber,
    reason: version.reason,
    createdByName: version.createdBy?.name ?? null,
    subtotal: version.subtotal.toFixed(2),
    discountAmount: version.discountAmount.toFixed(2),
    totalAmount: version.totalAmount.toFixed(2),
    totalCost: version.totalCost.toFixed(2),
    grossMargin: version.grossMargin.toFixed(2),
    marginPercentage: version.marginPercentage.toFixed(2),
    riskScore: version.riskScore.toFixed(2),
    // Stored as Json because a version is a snapshot rather than a live join;
    // the shape is `snapshotQuotation`'s own, asserted back to it here.
    lines: (version.lineSnapshot as unknown as LineSnapshot[]) ?? [],
    approvedAt: version.approvedAt?.toISOString() ?? null,
    createdAt: version.createdAt.toISOString(),
  }));
}
