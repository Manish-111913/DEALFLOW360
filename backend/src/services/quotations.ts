import { Prisma } from "../generated/prisma/client";
import { appendAudit } from "../audit";
import { currentBusinessTime } from "../clock";
import { prisma } from "../db";
import { NotFoundError, ValidationError } from "../errors";
import { computeOrderMargin, type DecimalValue, type MarginLineInput } from "../engines/margin";
import { resolveApprovalRoute } from "../engines/approval-routing";
import { computeRisk, type DeliveryRisk, type RiskResult } from "../engines/risk";
import type {
  ApprovalState,
  PortalStatus,
  QuotationStatus,
  RiskLevel,
} from "../generated/prisma/enums";
import { assertCan, type AuthzUser } from "../authz/roles";
import { isDenyAll, scopeFor } from "../authz/scope";
import { ADVISORY_LOCK } from "../locks";
import { getSettings } from "../settings";
import { resolveUnitPrice } from "./catalog";
import { loadActiveApprovalSteps } from "./approvals";
import { assertCustomerCanBeQuoted } from "./customers";
import { resolveCeilings } from "./discount-policy";
import { hasFulfillmentPlan, planFulfillment } from "./fulfillment";

const Decimal = Prisma.Decimal;

/** Rounding follows the configured currency, not a hardcoded 2 places. */
function money(value: Prisma.Decimal, minorUnits: number): Prisma.Decimal {
  return value.toDecimalPlaces(minorUnits, Decimal.ROUND_HALF_UP);
}

// ---------------------------------------------------------------------------
// D21 — the single recompute pipeline
// ---------------------------------------------------------------------------

export interface RecomputeResult {
  quotationId: string;
  subtotal: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  totalCost: Prisma.Decimal;
  grossMargin: Prisma.Decimal;
  marginPercentage: Prisma.Decimal;
  riskScore: number;
  riskLevel: RiskLevel;
  riskFactors: RiskResult["factors"];
  /** Preview only. Submitting is an explicit act; this never transitions state. */
  approvalRequired: boolean;
  approvalReason: string;
  explain: {
    margin: ReturnType<typeof computeOrderMargin>["explain"];
    risk: RiskResult["explain"];
    routing: ReturnType<typeof resolveApprovalRoute>["explain"];
  };
}

/**
 * Delivery risk for the score.
 *
 * Read from the advisory pre-flight plan (D4), which reserves nothing. It can
 * therefore be stale by the time stock is actually allocated - D15 records that
 * variance rather than re-triggering approval. Returns NONE until B-6 starts
 * producing plans, which is the correct answer for an order that has had no
 * fulfilment analysis yet.
 */
async function deliveryRiskFor(quotationId: string): Promise<DeliveryRisk> {
  const [openBackorders, plan] = await Promise.all([
    prisma.backorder.count({ where: { quotationId, status: "OPEN" } }),
    prisma.fulfillmentPlan.findFirst({
      where: { quotationId, status: { in: ["RECOMMENDED", "ACCEPTED"] } },
      orderBy: { createdAt: "desc" },
      select: { estimatedShipmentCount: true },
    }),
  ]);

  if (openBackorders > 0) return "BACKORDER";
  if (plan && plan.estimatedShipmentCount > 1) return "SPLIT";
  return "NONE";
}

/**
 * Recompute everything derived from the lines of a quotation.
 *
 * Every mutation goes through here - add, remove, quantity, price, discount,
 * accepted upsell. One function, one call site pattern. That is the mechanism
 * that stops the numbers on a screen drifting from the numbers in the database;
 * a convention asking people to remember would not survive the build.
 *
 * The ordered chain is: ceilings -> margin -> risk factors -> risk score ->
 * approval requirement -> advisory fulfilment plan. B-6 extends this function
 * rather than adding a parallel one.
 */
export async function recomputeQuotation(quotationId: string): Promise<RecomputeResult> {
  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    include: {
      customer: { select: { tier: true } },
      lines: {
        orderBy: { sequence: "asc" },
        include: {
          product: {
            select: {
              name: true,
              categoryId: true,
              tax: { select: { percentage: true } },
            },
          },
        },
      },
    },
  });
  if (!quotation) throw new NotFoundError(`Quotation ${quotationId} does not exist`);

  const settings = await getSettings();
  const { currencyMinorUnits } = settings;

  // 1. Ceilings (D10: category policy -> tier default -> fallback).
  const ceilings = await resolveCeilings(
    quotation.customer.tier,
    quotation.lines.map((l) => l.product.categoryId),
  );

  // 2. Margin.
  const marginInputs: MarginLineInput[] = quotation.lines.map((line) => ({
    lineId: line.id,
    label: line.product.name,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discountPercentage: line.discountPercentage,
    unitCost: line.unitCost,
  }));
  const margin = computeOrderMargin(marginInputs, { minorUnits: currencyMinorUnits });

  // Tax rides alongside margin but is never part of it: it is collected for the
  // state, so it is neither revenue nor margin.
  //
  // Commercial terms (price, cost) are snapshotted onto the line at add time, so
  // a catalogue change cannot reprice a quote a customer is looking at. A tax
  // rate is not a commercial term - it is statutory - so while the quotation is
  // still a draft it tracks the current rate. Once the quote has been sent, the
  // total the customer saw is honoured and the rate freezes.
  const taxIsLive = quotation.status === "DRAFT";
  let taxAmount = new Decimal(0);
  const now = currentBusinessTime();

  // 3. Keep an existing fulfilment plan current, so the delivery outlook the
  //    score reads is not describing a cart from three edits ago. Only
  //    refreshed when a plan already exists: generating one for a quote nobody
  //    has costed yet would be work on every keystroke for no benefit.
  if (await hasFulfillmentPlan(quotationId)) {
    await planFulfillment(quotationId);
  }

  // 4. Risk, from ceilings + margin + negotiation history + delivery outlook.
  const risk = computeRisk({
    lines: quotation.lines.map((line) => ({
      lineId: line.id,
      label: line.product.name,
      discountPercentage: line.discountPercentage,
      discountCeiling: ceilings.get(line.product.categoryId)?.ceiling ?? new Decimal(0),
    })),
    marginPercentage: margin.marginPercentage,
    targetMarginPercentage: settings.targetMarginPercentage,
    negotiationCount: quotation.negotiationCount,
    deliveryRisk: await deliveryRiskFor(quotationId),
  });

  // 5. Approval requirement - a preview, not a transition.
  const chain = await loadActiveApprovalSteps();
  const routing = resolveApprovalRoute({
    steps: chain,
    score: risk.score,
    anyLineOverCeiling: risk.anyLineOverCeiling,
    maxLineDiscount: risk.maxLineDiscount,
  });

  await prisma.$transaction(async (tx) => {
    for (const line of quotation.lines) {
      const computed = margin.lines.find((l) => l.lineId === line.id);
      if (!computed) continue;

      const ceiling = ceilings.get(line.product.categoryId)?.ceiling ?? new Decimal(0);
      const violation = line.discountPercentage.greaterThan(ceiling)
        ? line.discountPercentage.minus(ceiling)
        : new Decimal(0);

      const taxPercentage = taxIsLive
        ? (line.product.tax?.percentage ?? new Decimal(0))
        : line.taxPercentage;
      const lineTax = money(
        computed.netSellingValue.times(taxPercentage).dividedBy(100),
        currencyMinorUnits,
      );
      taxAmount = taxAmount.plus(lineTax);

      await tx.quotationLine.update({
        where: { id: line.id },
        data: {
          taxPercentage,
          discountCeiling: ceiling,
          violationPoints: violation,
          discountAmount: computed.discountAmount,
          lineSubtotal: computed.subtotal,
          lineTotal: computed.netSellingValue,
          taxAmount: lineTax,
          marginAmount: computed.grossMargin,
          marginPercentage: computed.marginPercentage,
          updatedAt: now,
        },
      });
    }

    taxAmount = money(taxAmount, currencyMinorUnits);

    // Risk factors are rewritten wholesale, so the table always explains the
    // current score rather than accumulating stale reasons.
    await tx.riskFactor.deleteMany({ where: { quotationId } });
    await tx.riskFactor.createMany({
      data: risk.factors.map((f) => ({
        quotationId,
        source: f.source,
        points: f.points,
        description: f.description,
        formula: f.formula,
        sequence: f.sequence,
        createdAt: now,
      })),
    });

    await tx.quotation.update({
      where: { id: quotationId },
      data: {
        subtotal: margin.subtotal,
        discountAmount: margin.discountAmount,
        taxAmount,
        totalAmount: money(margin.netSellingValue.plus(taxAmount), currencyMinorUnits),
        totalCost: margin.estimatedCost,
        grossMargin: margin.grossMargin,
        marginPercentage: margin.marginPercentage,
        riskScore: new Decimal(risk.score),
        riskLevel: risk.level,
        updatedAt: now,
        lastActivityAt: now,
      },
    });
  });

  return {
    quotationId,
    subtotal: margin.subtotal,
    discountAmount: margin.discountAmount,
    taxAmount,
    totalAmount: money(margin.netSellingValue.plus(taxAmount), currencyMinorUnits),
    totalCost: margin.estimatedCost,
    grossMargin: margin.grossMargin,
    marginPercentage: margin.marginPercentage,
    riskScore: risk.score,
    riskLevel: risk.level,
    riskFactors: risk.factors,
    approvalRequired: routing.required,
    approvalReason: routing.reason,
    explain: { margin: margin.explain, risk: risk.explain, routing: routing.explain },
  };
}

// ---------------------------------------------------------------------------
// Quotation lifecycle
// ---------------------------------------------------------------------------

/**
 * Sequential, human-readable quote numbers.
 *
 * Serialised by an advisory lock: two concurrent creations would otherwise read
 * the same count and both claim the same number.
 */
async function nextQuoteNumber(tx: Prisma.TransactionClient, now: Date): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK.quoteNumber})`;
  const { quoteNumberPrefix, quoteNumberPadding } = await getSettings();
  const year = now.getUTCFullYear();
  const prefix = `${quoteNumberPrefix}-${year}-`;
  const count = await tx.quotation.count({ where: { quoteNumber: { startsWith: prefix } } });
  return `${prefix}${String(count + 1).padStart(quoteNumberPadding, "0")}`;
}

export interface CreateQuotationInput {
  customerId: string;
  salesRepId: string;
  actorId?: string | null;
  validUntil?: Date | null;
}

export async function createQuotation(input: CreateQuotationInput) {
  // B-2's guard: without a tier there is no ceiling to check lines against, so
  // every governance rule downstream would pass vacuously.
  await assertCustomerCanBeQuoted(input.customerId);

  const now = currentBusinessTime();
  // The configured currency, not the column default: the setting is the source
  // of truth for behaviour, so a row must not disagree with it.
  const { currencyCode } = await getSettings();

  const quotation = await prisma.$transaction(async (tx) => {
    const quoteNumber = await nextQuoteNumber(tx, now);
    return tx.quotation.create({
      data: {
        quoteNumber,
        customerId: input.customerId,
        salesRepId: input.salesRepId,
        currency: currencyCode,
        validUntil: input.validUntil ?? null,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
  });

  await appendAudit({
    entityName: "Quotation",
    entityId: quotation.id,
    action: "CREATE",
    actorId: input.actorId ?? input.salesRepId,
    reason: "Quotation created",
    fieldChanges: { quoteNumber: quotation.quoteNumber, customerId: input.customerId },
  });

  return quotation;
}

export interface AddLineInput {
  quotationId: string;
  productId: string;
  variantId?: string | null;
  quantity: number;
  discountPercentage?: DecimalValue;
  /** Overrides the resolved price. Recorded, because it is a commercial act. */
  unitPriceOverride?: DecimalValue | null;
  isUpsell?: boolean;
  actorId?: string | null;
}

export async function addQuotationLine(input: AddLineInput) {
  if (input.quantity <= 0) {
    throw new ValidationError("Quantity must be greater than zero.", "quantity");
  }
  const discountPercentage = new Decimal(input.discountPercentage ?? 0);
  if (discountPercentage.lessThan(0) || discountPercentage.greaterThan(100)) {
    throw new ValidationError("Discount must be between 0 and 100 percent.", "discountPercentage");
  }

  const quotation = await prisma.quotation.findUnique({
    where: { id: input.quotationId },
    include: { customer: { select: { tier: true } } },
  });
  if (!quotation) throw new NotFoundError(`Quotation ${input.quotationId} does not exist`);

  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    include: { tax: { select: { percentage: true } } },
  });
  if (!product) throw new NotFoundError(`Product ${input.productId} does not exist`);

  // Price and cost are snapshotted onto the line. A later catalogue change must
  // not silently repri­ce a quotation a customer is already looking at.
  const resolved = await resolveUnitPrice({
    productId: input.productId,
    variantId: input.variantId ?? null,
    tier: quotation.customer.tier,
    quantity: input.quantity,
  });
  const unitPrice =
    input.unitPriceOverride != null ? new Decimal(input.unitPriceOverride) : resolved.unitPrice;

  const now = currentBusinessTime();
  const sequence = await prisma.quotationLine.count({ where: { quotationId: input.quotationId } });

  const line = await prisma.quotationLine.create({
    data: {
      quotationId: input.quotationId,
      productId: input.productId,
      variantId: input.variantId ?? null,
      sequence,
      quantity: input.quantity,
      unitPrice,
      discountPercentage,
      unitCost: product.costPrice,
      taxPercentage: product.tax?.percentage ?? new Decimal(0),
      isUpsell: input.isUpsell ?? false,
      isRecurring: product.type === "SUBSCRIPTION",
      createdAt: now,
      updatedAt: now,
    },
  });

  await appendAudit({
    entityName: "Quotation",
    entityId: input.quotationId,
    action: "UPDATE",
    actorId: input.actorId ?? quotation.salesRepId,
    reason: `Line added: ${product.name}`,
    fieldChanges: {
      lineId: line.id,
      product: product.name,
      quantity: input.quantity,
      unitPrice: unitPrice.toFixed(2),
      priceSource: resolved.source,
      discountPercentage: discountPercentage.toFixed(2),
      ...(input.unitPriceOverride != null ? { unitPriceOverridden: true } : {}),
    },
  });

  await recomputeQuotation(input.quotationId);
  return line;
}

export interface UpdateLineInput {
  lineId: string;
  quantity?: number;
  unitPrice?: DecimalValue;
  discountPercentage?: DecimalValue;
  actorId?: string | null;
}

export async function updateQuotationLine(input: UpdateLineInput) {
  const existing = await prisma.quotationLine.findUnique({
    where: { id: input.lineId },
    include: { product: { select: { name: true } }, quotation: { select: { salesRepId: true } } },
  });
  if (!existing) throw new NotFoundError(`Quotation line ${input.lineId} does not exist`);

  if (input.quantity !== undefined && input.quantity <= 0) {
    throw new ValidationError("Quantity must be greater than zero.", "quantity");
  }
  if (input.discountPercentage !== undefined) {
    const d = new Decimal(input.discountPercentage);
    if (d.lessThan(0) || d.greaterThan(100)) {
      throw new ValidationError("Discount must be between 0 and 100 percent.", "discountPercentage");
    }
  }

  const now = currentBusinessTime();
  const changes: Record<string, { before: string; after: string }> = {};

  if (input.quantity !== undefined && input.quantity !== existing.quantity) {
    changes.quantity = { before: String(existing.quantity), after: String(input.quantity) };
  }
  if (input.unitPrice !== undefined && !existing.unitPrice.equals(new Decimal(input.unitPrice))) {
    changes.unitPrice = {
      before: existing.unitPrice.toFixed(2),
      after: new Decimal(input.unitPrice).toFixed(2),
    };
  }
  if (
    input.discountPercentage !== undefined &&
    !existing.discountPercentage.equals(new Decimal(input.discountPercentage))
  ) {
    changes.discountPercentage = {
      before: existing.discountPercentage.toFixed(2),
      after: new Decimal(input.discountPercentage).toFixed(2),
    };
  }

  const line = await prisma.quotationLine.update({
    where: { id: input.lineId },
    data: {
      ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
      ...(input.unitPrice !== undefined ? { unitPrice: new Decimal(input.unitPrice) } : {}),
      ...(input.discountPercentage !== undefined
        ? { discountPercentage: new Decimal(input.discountPercentage) }
        : {}),
      updatedAt: now,
    },
  });

  // A no-op edit writes no audit row: a trail full of "changed nothing" is
  // harder to read, not more complete.
  if (Object.keys(changes).length > 0) {
    await appendAudit({
      entityName: "Quotation",
      entityId: existing.quotationId,
      action: "UPDATE",
      actorId: input.actorId ?? existing.quotation.salesRepId,
      reason: `Line edited: ${existing.product.name}`,
      fieldChanges: { lineId: existing.id, ...changes },
    });
  }

  await recomputeQuotation(existing.quotationId);
  return line;
}

export async function removeQuotationLine(lineId: string, actorId?: string | null) {
  const existing = await prisma.quotationLine.findUnique({
    where: { id: lineId },
    include: { product: { select: { name: true } }, quotation: { select: { salesRepId: true } } },
  });
  if (!existing) throw new NotFoundError(`Quotation line ${lineId} does not exist`);

  await prisma.quotationLine.delete({ where: { id: lineId } });

  await appendAudit({
    entityName: "Quotation",
    entityId: existing.quotationId,
    action: "UPDATE",
    actorId: actorId ?? existing.quotation.salesRepId,
    reason: `Line removed: ${existing.product.name}`,
    fieldChanges: { lineId, quantity: existing.quantity },
  });

  return recomputeQuotation(existing.quotationId);
}

/**
 * Read a quotation with everything a builder screen needs.
 *
 * The payload carries unit costs, line margins and discount ceilings, so it is
 * an internal object by construction. Taking the caller is what makes that
 * enforceable: a visibility check answers "may they see this row?", which is a
 * different question from "may they see it in this shape?" (D20). Callers used
 * to answer only the first, so a portal identity reading their own quotation
 * was handed our cost base with it.
 */
export async function getQuotation(user: AuthzUser, quotationId: string) {
  // Two different questions, and both have to be asked here.
  //
  // The capability check says this kind of user may see costs and margins at
  // all. It does not say anything about *which* rows - and a SALES_REP holds
  // "margin" for their own deals, so on its own it let one rep read another
  // rep's quotation in full. The scope check is what answers that, and it
  // lives here rather than in the callers because callers forget: the AI
  // context builder did exactly that, and every route would have to remember
  // it again.
  assertCan(user, "view", "margin");
  await assertQuotationVisible(user, quotationId);

  return prisma.quotation.findUnique({
    where: { id: quotationId },
    include: {
      customer: { select: { id: true, name: true, tier: true } },
      salesRep: { select: { id: true, name: true } },
      lines: {
        orderBy: { sequence: "asc" },
        include: {
          product: { select: { id: true, name: true, sku: true, categoryId: true } },
          variant: { select: { id: true, attributeName: true, attributeValue: true } },
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

/** The pipeline stage a quotation is in, derived rather than stored. */
export type PipelineStage =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "NEGOTIATION"
  | "APPROVED"
  | "FULFILLMENT"
  | "CLOSED";

export interface QuotationListRow {
  id: string;
  quoteNumber: string;
  customerId: string;
  customerName: string;
  salesRepId: string;
  salesRepName: string;
  status: QuotationStatus;
  approvalState: ApprovalState;
  /** Whether the customer can see this, and what they have done with it. */
  portalStatus: PortalStatus;
  stage: PipelineStage;
  totalAmount: string;
  marginPercentage: string;
  riskScore: string;
  riskLevel: RiskLevel;
  negotiationCount: number;
  lastActivityAt: Date;
  validUntil: Date | null;
  lineCount: number;
}

/**
 * Which of the five pipeline stages a quotation is in.
 *
 * The schema stores two orthogonal things - `status` (DRAFT | SENT | CONFIRMED
 * | CANCELLED) and `approvalState` (NONE | PENDING_MANAGER | PENDING_FINANCE |
 * APPROVED | REJECTED | RETURNED). The board the sales team works from is a
 * single ladder, so the stage is derived from both rather than stored as a
 * third field that could disagree with them.
 *
 * Order matters: a confirmed order is closed no matter what its approval state
 * says, and a quote awaiting a decision is "pending approval" even though its
 * status is still DRAFT.
 */
export function stageOf(quotation: {
  status: QuotationStatus;
  approvalState: ApprovalState;
  negotiationCount: number;
}): PipelineStage {
  if (quotation.status === "CANCELLED") return "CLOSED";
  if (quotation.status === "CONFIRMED") return "FULFILLMENT";
  if (quotation.approvalState === "PENDING_MANAGER" || quotation.approvalState === "PENDING_FINANCE") {
    return "PENDING_APPROVAL";
  }
  if (quotation.approvalState === "APPROVED") return "APPROVED";
  // A returned or rejected quote is back with the rep, and one the customer has
  // countered is in negotiation - both are still being worked, not closed.
  if (quotation.negotiationCount > 0) return "NEGOTIATION";
  return "DRAFT";
}

export interface ListQuotationsFilters {
  stage?: PipelineStage;
  customerId?: string;
  /** Restrict to the caller's own deals, on top of whatever scoping allows. */
  mineOnly?: boolean;
  search?: string;
  take?: number;
}

/**
 * The quotation list behind the Sales Workspace and the command centre.
 *
 * `getQuotation` reads one deal in full; nothing could list them, so the
 * pipeline board had no source and was hardcoded. This is that source.
 *
 * Scoping is not optional and not the caller's job: `scopeFor` decides which
 * rows this user may see at all - a rep their own, a manager their team's,
 * finance and admin everything - and the filters narrow within that. A caller
 * cannot widen it, because the scope fragment and the filters are ANDed.
 */
export async function listQuotations(
  user: AuthzUser,
  filters: ListQuotationsFilters = {},
): Promise<QuotationListRow[]> {
  // "view quotation" is the wrong gate on its own: a portal identity holds it,
  // but a QuotationListRow carries marginPercentage, riskScore and riskLevel.
  // The matrix already says a customer may never see those - this asks it.
  // Portal callers want `listPortalQuotations` instead.
  assertCan(user, "view", "quotation");
  assertCan(user, "view", "margin");

  const scope = scopeFor(user, "Quotation");
  if (isDenyAll(scope)) return [];

  const where: Prisma.QuotationWhereInput = { ...(scope as Prisma.QuotationWhereInput) };

  if (filters.customerId) where.customerId = filters.customerId;
  if (filters.mineOnly) where.salesRepId = user.id;
  if (filters.search) {
    const term = filters.search.trim();
    if (term) {
      where.OR = [
        { quoteNumber: { contains: term, mode: "insensitive" } },
        { customer: { name: { contains: term, mode: "insensitive" } } },
      ];
    }
  }

  const rows = await prisma.quotation.findMany({
    where,
    orderBy: { lastActivityAt: "desc" },
    take: filters.take ?? 200,
    include: {
      customer: { select: { id: true, name: true } },
      salesRep: { select: { id: true, name: true } },
      _count: { select: { lines: true } },
    },
  });

  const mapped: QuotationListRow[] = rows.map((q) => ({
    id: q.id,
    quoteNumber: q.quoteNumber,
    customerId: q.customerId,
    customerName: q.customer.name,
    salesRepId: q.salesRepId,
    salesRepName: q.salesRep.name,
    status: q.status,
    approvalState: q.approvalState,
    portalStatus: q.portalStatus,
    stage: stageOf(q),
    totalAmount: q.totalAmount.toFixed(2),
    marginPercentage: q.marginPercentage.toFixed(2),
    riskScore: q.riskScore.toFixed(2),
    riskLevel: q.riskLevel,
    negotiationCount: q.negotiationCount,
    lastActivityAt: q.lastActivityAt,
    validUntil: q.validUntil,
    lineCount: q._count.lines,
  }));

  // Stage is derived, so it cannot be a database filter without duplicating the
  // rule in SQL. Filtering here keeps one definition of what a stage means.
  return filters.stage ? mapped.filter((row) => row.stage === filters.stage) : mapped;
}

/** What a customer may be told about their own quotations: no margin, no risk. */
export interface PortalQuotationRow {
  id: string;
  quoteNumber: string;
  status: QuotationStatus;
  portalStatus: PortalStatus;
  totalAmount: string;
  validUntil: Date | null;
}

/**
 * The portal's own list, as a separate object rather than a filtered internal
 * one (D20).
 *
 * Building a whitelist here means a field added to `QuotationListRow` later
 * cannot silently reach a customer: it has to be added to this shape too, and
 * that is a decision someone makes on purpose.
 */
export async function listPortalQuotations(user: AuthzUser): Promise<PortalQuotationRow[]> {
  assertCan(user, "view", "quotation");

  const scope = scopeFor(user, "Quotation");
  if (isDenyAll(scope)) return [];

  const rows = await prisma.quotation.findMany({
    where: scope as Prisma.QuotationWhereInput,
    orderBy: { lastActivityAt: "desc" },
    take: 200,
    select: {
      id: true,
      quoteNumber: true,
      status: true,
      portalStatus: true,
      totalAmount: true,
      validUntil: true,
    },
  });

  return rows.map((q) => ({
    id: q.id,
    quoteNumber: q.quoteNumber,
    status: q.status,
    portalStatus: q.portalStatus,
    totalAmount: q.totalAmount.toFixed(2),
    validUntil: q.validUntil,
  }));
}

/**
 * The five pipeline columns with their counts and values.
 *
 * Derived from the same scoped list, so the board totals can never disagree
 * with the rows underneath them.
 */
export async function getPipelineSummary(user: AuthzUser) {
  const rows = await listQuotations(user);

  const stages: PipelineStage[] = [
    "DRAFT",
    "PENDING_APPROVAL",
    "NEGOTIATION",
    "APPROVED",
    "FULFILLMENT",
  ];

  const byStage = stages.map((stage) => {
    const inStage = rows.filter((row) => row.stage === stage);
    const value = inStage.reduce((sum, row) => sum + Number(row.totalAmount), 0);
    return { stage, count: inStage.length, value: value.toFixed(2) };
  });

  const totalValue = byStage.reduce((sum, s) => sum + Number(s.value), 0);

  return {
    stages: byStage,
    totalDeals: rows.length,
    totalValue: totalValue.toFixed(2),
  };
}

/**
 * May this user see this quotation at all?
 *
 * `getQuotation`, `getApprovalOverview`, `getFulfillmentView` and
 * `getBillingSchedule` are raw loaders: they take an id, check nothing, and
 * return the row. That is fine inside the backend, where the caller has already
 * been authorised - but an HTTP route that passes a URL parameter straight into
 * one of them is an IDOR, and every screen does exactly that.
 *
 * So routes call this first. It answers with the same scope rule the list uses,
 * which means a rep asking for another rep's quotation by id gets the same
 * answer as a rep who simply cannot see it in a list: not found.
 */
export async function assertQuotationVisible(
  user: AuthzUser,
  quotationId: string,
): Promise<void> {
  assertCan(user, "view", "quotation");

  const scope = scopeFor(user, "Quotation");
  if (isDenyAll(scope)) {
    throw new NotFoundError(`Quotation ${quotationId} does not exist`);
  }

  const visible = await prisma.quotation.findFirst({
    where: { AND: [{ id: quotationId }, scope as Prisma.QuotationWhereInput] },
    select: { id: true },
  });

  if (visible) return;

  /**
   * A reviewer can see what they have been asked to decide.
   *
   * Ownership is not the only reason to be allowed to read a quotation. A Sales
   * Manager is scoped to their own team, so a deal raised outside it that routes
   * to them for approval was invisible to the very person the routing engine
   * named - and, because Admin holds no `decide` capability, a quote raised by
   * an admin ended up with every role that could decide it unable to see it and
   * the one role that could see it unable to decide. It sat pending for ever.
   *
   * Being asked is the grant, and it is deliberately narrow: the request must
   * still be PENDING, its step must belong to this user's role, and if it names
   * an assignee it must be this user. That admits exactly the deals that would
   * otherwise be stuck and nothing else.
   *
   * It lives here, rather than in the approvals screen, for the reason the
   * comment above says the scope check lives in `getQuotation`: callers forget.
   */
  if (user.kind === "INTERNAL" && (user.role === "SALES_MANAGER" || user.role === "FINANCE_OPS")) {
    const mine = await prisma.approvalRequest.count({
      where: {
        quotationId,
        status: "PENDING",
        step: { approverRole: user.role },
      // Narrow on purpose. `assignedToId` is never populated - nothing in the
      // codebase writes it - so matching "unassigned" would match every pending
      // request of this role and hand a manager the other team's book. The only
      // deals that genuinely need this widening are the orphans: a quotation
      // whose owner belongs to no sales team is inside no team-scoped manager's
      // view, so without this nobody could ever decide it. Everything else stays
      // where D6 put it.
      quotation: { salesRep: { salesTeamId: null } },
      },
    });
    if (mine > 0) return;
  }

  // Deliberately "not found" rather than "forbidden": telling an unauthorised
  // caller that a record exists is itself a disclosure.
  throw new NotFoundError(`Quotation ${quotationId} does not exist`);
}
