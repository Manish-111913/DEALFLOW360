import { Prisma } from "../generated/prisma/client";
import { appendAudit } from "../audit";
import { currentBusinessTime } from "../clock";
import { prisma } from "../db";
import { NotFoundError, ValidationError } from "../errors";
import { computeOrderMargin, type DecimalValue, type MarginLineInput } from "../engines/margin";
import { ADVISORY_LOCK } from "../locks";
import { getSettings } from "../settings";
import { resolveUnitPrice } from "./catalog";
import { assertCustomerCanBeQuoted } from "./customers";

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
  explain: ReturnType<typeof computeOrderMargin>["explain"];
}

/**
 * Recompute everything derived from a quotation's lines.
 *
 * Every mutation goes through here — add, remove, quantity, price, discount,
 * accepted upsell. One function, one call site pattern. That is the mechanism
 * that stops the numbers on a screen drifting from the numbers in the database;
 * a convention asking people to remember would not survive the build.
 *
 * The ordered chain is: margin -> risk factors -> risk score -> approval
 * requirement -> advisory fulfilment plan. Only the first step exists today;
 * B-4 and B-6 extend this function rather than adding parallel ones.
 */
export async function recomputeQuotation(quotationId: string): Promise<RecomputeResult> {
  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    include: {
      lines: {
        orderBy: { sequence: "asc" },
        include: { product: { select: { tax: { select: { percentage: true } } } } },
      },
    },
  });
  if (!quotation) throw new NotFoundError(`Quotation ${quotationId} does not exist`);

  const { currencyMinorUnits } = await getSettings();

  const marginInputs: MarginLineInput[] = quotation.lines.map((line) => ({
    lineId: line.id,
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
  // rate is not a commercial term — it is statutory — so while the quotation is
  // still a draft it tracks the current rate. Once the quote has been sent, the
  // total the customer saw is honoured and the rate freezes.
  const taxIsLive = quotation.status === "DRAFT";
  let taxAmount = new Decimal(0);
  const now = currentBusinessTime();

  await prisma.$transaction(async (tx) => {
    for (const line of quotation.lines) {
      const computed = margin.lines.find((l) => l.lineId === line.id);
      if (!computed) continue;

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
        updatedAt: now,
        lastActivityAt: now,
      },
    });
  });

  // B-4 extends here: risk factors, risk score, approval requirement.
  // B-6 extends here: advisory FulfillmentPlan (which reserves nothing).

  return {
    quotationId,
    subtotal: margin.subtotal,
    discountAmount: margin.discountAmount,
    taxAmount,
    totalAmount: money(margin.netSellingValue.plus(taxAmount), currencyMinorUnits),
    totalCost: margin.estimatedCost,
    grossMargin: margin.grossMargin,
    marginPercentage: margin.marginPercentage,
    explain: margin.explain,
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
