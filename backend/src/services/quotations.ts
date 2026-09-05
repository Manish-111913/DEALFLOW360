import { Prisma } from "../generated/prisma/client";
import { appendAudit } from "../audit";
import { currentBusinessTime } from "../clock";
import { prisma } from "../db";
import { NotFoundError, ValidationError } from "../errors";
import { computeOrderMargin, type DecimalValue, type MarginLineInput } from "../engines/margin";
import { resolveApprovalRoute } from "../engines/approval-routing";
import { computeRisk, type DeliveryRisk, type RiskResult } from "../engines/risk";
import type { RiskLevel } from "../generated/prisma/enums";
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

/** Read a quotation with everything a builder screen needs. */
export async function getQuotation(quotationId: string) {
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
