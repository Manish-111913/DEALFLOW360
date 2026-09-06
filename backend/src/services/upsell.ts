import { Prisma } from "../generated/prisma/client";
import { appendAudit } from "../audit";
import { currentBusinessTime } from "../clock";
import { prisma } from "../db";
import { NotFoundError } from "../errors";
import { rankUpsells, type UpsellCandidateInput, type UpsellSuggestion } from "../engines/upsell";
import { getSettings } from "../settings";
import { resolveUnitPrice } from "./catalog";
import { addQuotationLine } from "./quotations";

const Decimal = Prisma.Decimal;

/**
 * D14 — co-purchase rates are derived from real order history.
 *
 * An admin-typed number is exactly what "static suggestion" means, and §7 asks
 * for recommendations grounded in data. This computes P(B in order | A in
 * order) over confirmed quotations, and the ranking engine reads the derived
 * value unless an admin has explicitly overridden it.
 */

interface DerivedRate {
  base: string;
  suggested: string;
  rate: number;
  baseOrders: number;
}

export interface RefreshResult {
  pairsEvaluated: number;
  pairsWritten: number;
  minimumSample: number;
}

/**
 * Recompute every co-purchase rate from confirmed orders.
 *
 * Cheap enough to run on a timer or from an admin button; there is no need for
 * a queue. Pairings below the minimum sample are skipped rather than written,
 * because a pairing seen once would otherwise claim a 100% co-purchase rate and
 * outrank everything real.
 */
export async function refreshCoPurchaseRates(actorId?: string | null): Promise<RefreshResult> {
  const { upsellMinCoPurchaseSample } = await getSettings();
  const minimumSample = upsellMinCoPurchaseSample;

  const rows = await prisma.$queryRaw<DerivedRate[]>`
    WITH confirmed AS (
      SELECT DISTINCT q."id" AS qid, l."productId" AS product_id
        FROM "Quotation" q
        JOIN "QuotationLine" l ON l."quotationId" = q."id"
       WHERE q."status" = 'CONFIRMED'
    ),
    base_counts AS (
      SELECT product_id AS base, COUNT(DISTINCT qid)::int AS base_orders
        FROM confirmed
       GROUP BY product_id
    ),
    pair_counts AS (
      SELECT a.product_id AS base,
             b.product_id AS suggested,
             COUNT(DISTINCT a.qid)::int AS both_orders
        FROM confirmed a
        JOIN confirmed b ON b.qid = a.qid AND b.product_id <> a.product_id
       GROUP BY a.product_id, b.product_id
    )
    SELECT p.base            AS "base",
           p.suggested       AS "suggested",
           (p.both_orders::numeric / c.base_orders::numeric)::float8 AS "rate",
           c.base_orders     AS "baseOrders"
      FROM pair_counts p
      JOIN base_counts c ON c.base = p.base
     WHERE c.base_orders >= ${minimumSample}
  `;

  const now = currentBusinessTime();
  let written = 0;

  for (const row of rows) {
    const rate = new Decimal(row.rate).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    const existing = await prisma.productPairing.findUnique({
      where: {
        baseProductId_suggestedProductId: {
          baseProductId: row.base,
          suggestedProductId: row.suggested,
        },
      },
    });

    if (existing) {
      // configuredRate is an admin override and is never touched here.
      await prisma.productPairing.update({
        where: { id: existing.id },
        data: { coPurchaseRate: rate, updatedAt: now },
      });
    } else {
      await prisma.productPairing.create({
        data: {
          baseProductId: row.base,
          suggestedProductId: row.suggested,
          coPurchaseRate: rate,
          createdAt: now,
          updatedAt: now,
        },
      });
    }
    written += 1;
  }

  if (written > 0) {
    await appendAudit({
      entityName: "ProductPairing",
      entityId: "all",
      action: "CONFIGURE",
      actorId: actorId ?? null,
      reason: "Co-purchase rates recomputed from confirmed order history",
      fieldChanges: { pairsWritten: written, minimumSample },
    });
  }

  return { pairsEvaluated: rows.length, pairsWritten: written, minimumSample };
}

/**
 * Suggestions for the current cart.
 *
 * Products already in the cart are excluded — suggesting what a rep has just
 * added reads as broken, not helpful.
 */
export async function getUpsellSuggestions(
  quotationId: string,
  options?: { persist?: boolean },
): Promise<UpsellSuggestion[]> {
  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    include: {
      customer: { select: { tier: true } },
      lines: { include: { product: { select: { id: true, name: true } } } },
    },
  });
  if (!quotation) throw new NotFoundError(`Quotation ${quotationId} does not exist`);

  const inCart = new Set(quotation.lines.map((l) => l.productId));
  if (inCart.size === 0) return [];

  const pairings = await prisma.productPairing.findMany({
    where: {
      baseProductId: { in: [...inCart] },
      suggestedProductId: { notIn: [...inCart] },
      isActive: true,
      suggestedProduct: { isActive: true },
    },
    include: {
      baseProduct: { select: { name: true } },
      suggestedProduct: { select: { id: true, name: true, costPrice: true } },
    },
  });

  const candidates: UpsellCandidateInput[] = [];
  for (const pairing of pairings) {
    const price = await resolveUnitPrice({
      productId: pairing.suggestedProductId,
      tier: quotation.customer.tier,
      quantity: 1,
    });

    candidates.push({
      productId: pairing.suggestedProduct.id,
      productName: pairing.suggestedProduct.name,
      // An admin override wins over the derived value; otherwise history rules.
      coPurchaseRate: pairing.configuredRate ?? pairing.coPurchaseRate,
      minMarginPercentage: pairing.minMarginPercentage,
      isPromoted: (await isPromoted(pairing.suggestedProductId)) ?? false,
      unitPrice: price.unitPrice,
      unitCost: pairing.suggestedProduct.costPrice,
      triggeredByProductName: pairing.baseProduct.name,
    });
  }

  // The three controls on the Settings screen are read here, so turning one
  // off genuinely changes which suggestions surface and in what order.
  const settings = await getSettings();
  const suggestions = rankUpsells(candidates, {
    policy: {
      useHistory: settings.upsellUseHistory,
      usePromoted: settings.upsellUsePromoted,
      minMarginPercentage: settings.upsellMinMargin,
    },
  });

  if (options?.persist !== false) {
    const now = currentBusinessTime();
    await prisma.$transaction(async (tx) => {
      // Replace the open suggestions; accepted and dismissed ones are history.
      await tx.upsellRecommendation.deleteMany({
        where: { quotationId, status: "SUGGESTED" },
      });
      if (suggestions.length > 0) {
        await tx.upsellRecommendation.createMany({
          data: suggestions.map((s) => ({
            quotationId,
            productId: s.productId,
            score: s.score,
            marginDelta: s.marginImpact,
            reason: s.reason,
            createdAt: now,
          })),
        });
      }
    });
  }

  return suggestions;
}

const promotedCache = new Map<string, boolean>();
async function isPromoted(productId: string): Promise<boolean> {
  const cached = promotedCache.get(productId);
  if (cached !== undefined) return cached;
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { isPromoted: true },
  });
  const value = product?.isPromoted ?? false;
  promotedCache.set(productId, value);
  return value;
}

/**
 * Accept a suggestion.
 *
 * Goes through addQuotationLine, so the D21 recompute runs: total, cost, margin
 * and risk all move together. A high-margin upsell *lowers* the risk score by
 * closing the margin gap, while any ceiling breach elsewhere keeps approval
 * required — the two triggers are independent, and this is where that shows.
 */
export async function acceptUpsell(params: {
  quotationId: string;
  productId: string;
  quantity?: number;
  actorId?: string | null;
}) {
  const line = await addQuotationLine({
    quotationId: params.quotationId,
    productId: params.productId,
    quantity: params.quantity ?? 1,
    discountPercentage: 0,
    isUpsell: true,
    actorId: params.actorId,
  });

  const now = currentBusinessTime();
  await prisma.upsellRecommendation.updateMany({
    where: { quotationId: params.quotationId, productId: params.productId, status: "SUGGESTED" },
    data: { status: "ACCEPTED", actedAt: now },
  });

  return line;
}

export async function dismissUpsell(params: {
  quotationId: string;
  productId: string;
}): Promise<number> {
  const now = currentBusinessTime();
  const result = await prisma.upsellRecommendation.updateMany({
    where: { quotationId: params.quotationId, productId: params.productId, status: "SUGGESTED" },
    data: { status: "DISMISSED", actedAt: now },
  });
  return result.count;
}
