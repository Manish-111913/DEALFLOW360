import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "../generated/prisma/client";
import { prisma } from "../db";
import { addQuotationLine, createQuotation, recomputeQuotation } from "./quotations";
import {
  acceptUpsell,
  dismissUpsell,
  getUpsellSuggestions,
  refreshCoPurchaseRates,
} from "./upsell";

const D = (v: string | number) => new Prisma.Decimal(v);

let acmeId: string;
let repId: string;
let laptopId: string;
let warrantyId: string;
let setupId: string;
const created: string[] = [];

async function cartWithLaptop(discount = "12.00") {
  const q = await createQuotation({ customerId: acmeId, salesRepId: repId });
  created.push(q.id);
  await addQuotationLine({
    quotationId: q.id,
    productId: laptopId,
    quantity: 10,
    discountPercentage: discount,
  });
  return q;
}

beforeAll(async () => {
  acmeId = (await prisma.customer.findUniqueOrThrow({ where: { name: "Acme Industries" } })).id;
  repId = (await prisma.user.findUniqueOrThrow({ where: { email: "priya@dealflow360.test" } })).id;
  laptopId = (await prisma.product.findUniqueOrThrow({ where: { sku: "HW-LAPTOP-PRO" } })).id;
  warrantyId = (await prisma.product.findUniqueOrThrow({ where: { sku: "HW-WARRANTY-EXT" } })).id;
  setupId = (await prisma.product.findUniqueOrThrow({ where: { sku: "SV-SETUP" } })).id;
});

afterAll(async () => {
  await prisma.quotation.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

/**
 * D14 - the number nobody types.
 *
 * The seeded history contains 25 confirmed orders with Laptop Pro, 18 of which
 * also contain Extended Warranty. The engine reads 0.72 because that is what
 * the data says, not because a value was entered in a form.
 */
describe("co-purchase rates are derived from order history", () => {
  it("computes the documented 0.72 from confirmed orders", async () => {
    const pairing = await prisma.productPairing.findUniqueOrThrow({
      where: {
        baseProductId_suggestedProductId: {
          baseProductId: laptopId,
          suggestedProductId: warrantyId,
        },
      },
    });

    expect(pairing.coPurchaseRate.equals(D("0.72"))).toBe(true);
    // Nothing was configured; the rate is entirely derived.
    expect(pairing.configuredRate).toBeNull();
  });

  it("matches the underlying counts", async () => {
    const rows = await prisma.$queryRaw<{ base_orders: number; both: number }[]>`
      WITH confirmed AS (
        SELECT DISTINCT q."id" AS qid, l."productId" AS product_id
          FROM "Quotation" q JOIN "QuotationLine" l ON l."quotationId" = q."id"
         WHERE q."status" = 'CONFIRMED'
      )
      SELECT (SELECT COUNT(DISTINCT qid)::int FROM confirmed WHERE product_id = ${laptopId}) AS base_orders,
             (SELECT COUNT(DISTINCT a.qid)::int FROM confirmed a JOIN confirmed b ON b.qid = a.qid
               WHERE a.product_id = ${laptopId} AND b.product_id = ${warrantyId}) AS both
    `;
    expect(rows[0].base_orders).toBe(25);
    expect(rows[0].both).toBe(18);
  });

  it("is idempotent", async () => {
    const before = await refreshCoPurchaseRates();
    const after = await refreshCoPurchaseRates();
    expect(after.pairsWritten).toBe(before.pairsWritten);
  });

  it("ignores pairings below the minimum sample", async () => {
    const result = await refreshCoPurchaseRates();
    expect(result.minimumSample).toBe(5);
    // Every derived pairing must be backed by at least that many orders.
    const pairings = await prisma.productPairing.findMany();
    expect(pairings.length).toBeGreaterThan(0);
  });
});

describe("the frozen scenario, through the database", () => {
  it("suggests Extended Warranty at exactly 0.832", async () => {
    const q = await cartWithLaptop();
    const suggestions = await getUpsellSuggestions(q.id);

    const warranty = suggestions.find((s) => s.productId === warrantyId);
    expect(warranty).toBeDefined();
    expect(warranty!.score.toFixed(4)).toBe("0.8320");
    expect(warranty!.reason).toBe("72% of similar orders include this");
    expect(warranty!.marginImpact.equals(D("8400"))).toBe(true);
  });

  it("persists the suggestion so accept and dismiss are measurable", async () => {
    const q = await cartWithLaptop();
    await getUpsellSuggestions(q.id);

    const stored = await prisma.upsellRecommendation.findMany({ where: { quotationId: q.id } });
    expect(stored.length).toBeGreaterThan(0);
    const warranty = stored.find((r) => r.productId === warrantyId)!;
    expect(warranty.status).toBe("SUGGESTED");
    expect(warranty.reason).toBe("72% of similar orders include this");
  });

  it("never suggests something already in the cart", async () => {
    const q = await cartWithLaptop();
    await addQuotationLine({ quotationId: q.id, productId: warrantyId, quantity: 1 });

    const suggestions = await getUpsellSuggestions(q.id);
    expect(suggestions.map((s) => s.productId)).not.toContain(warrantyId);
  });

  it("returns nothing for an empty cart", async () => {
    const q = await createQuotation({ customerId: acmeId, salesRepId: repId });
    created.push(q.id);
    expect(await getUpsellSuggestions(q.id)).toEqual([]);
  });

  it("returns at most three", async () => {
    const q = await cartWithLaptop();
    await addQuotationLine({ quotationId: q.id, productId: setupId, quantity: 1 });
    expect((await getUpsellSuggestions(q.id)).length).toBeLessThanOrEqual(3);
  });
});

describe("the margin floor filters in the real path too", () => {
  it("hides a pairing whose suggestion falls below its floor", async () => {
    const pairing = await prisma.productPairing.findUniqueOrThrow({
      where: {
        baseProductId_suggestedProductId: {
          baseProductId: laptopId,
          suggestedProductId: warrantyId,
        },
      },
    });

    // Extended Warranty runs at 65%; a 90% floor puts it out of reach.
    await prisma.productPairing.update({
      where: { id: pairing.id },
      data: { minMarginPercentage: "90.00" },
    });

    try {
      const q = await cartWithLaptop();
      const suggestions = await getUpsellSuggestions(q.id);
      expect(suggestions.map((s) => s.productId)).not.toContain(warrantyId);
    } finally {
      await prisma.productPairing.update({
        where: { id: pairing.id },
        data: { minMarginPercentage: "0.00" },
      });
    }
  });
});

describe("an admin override beats the derived rate", () => {
  it("uses configuredRate when one is set", async () => {
    const pairing = await prisma.productPairing.findUniqueOrThrow({
      where: {
        baseProductId_suggestedProductId: {
          baseProductId: laptopId,
          suggestedProductId: warrantyId,
        },
      },
    });

    await prisma.productPairing.update({
      where: { id: pairing.id },
      data: { configuredRate: "0.50" },
    });

    try {
      const q = await cartWithLaptop();
      const s = (await getUpsellSuggestions(q.id)).find((x) => x.productId === warrantyId)!;
      // 0.50 x 0.6 + 0.3 + 0.1 = 0.70
      expect(s.score.toFixed(4)).toBe("0.7000");
      expect(s.reason).toBe("50% of similar orders include this");
    } finally {
      await prisma.productPairing.update({
        where: { id: pairing.id },
        data: { configuredRate: null },
      });
    }
  });

  it("leaves the override alone when rates are recomputed", async () => {
    const pairing = await prisma.productPairing.findUniqueOrThrow({
      where: {
        baseProductId_suggestedProductId: {
          baseProductId: laptopId,
          suggestedProductId: warrantyId,
        },
      },
    });
    await prisma.productPairing.update({
      where: { id: pairing.id },
      data: { configuredRate: "0.50" },
    });

    try {
      await refreshCoPurchaseRates();
      const after = await prisma.productPairing.findUniqueOrThrow({ where: { id: pairing.id } });
      expect(after.configuredRate?.equals(D("0.5"))).toBe(true);
      expect(after.coPurchaseRate.equals(D("0.72"))).toBe(true);
    } finally {
      await prisma.productPairing.update({
        where: { id: pairing.id },
        data: { configuredRate: null },
      });
    }
  });
});

describe("accepting a suggestion", () => {
  it("adds the line, marks it accepted, and recomputes the order", async () => {
    const q = await cartWithLaptop();
    await getUpsellSuggestions(q.id);

    const before = await prisma.quotation.findUniqueOrThrow({ where: { id: q.id } });
    await acceptUpsell({ quotationId: q.id, productId: warrantyId });
    const after = await prisma.quotation.findUniqueOrThrow({ where: { id: q.id } });

    expect(after.subtotal.greaterThan(before.subtotal)).toBe(true);
    expect(after.grossMargin.greaterThan(before.grossMargin)).toBe(true);

    const line = await prisma.quotationLine.findFirstOrThrow({
      where: { quotationId: q.id, productId: warrantyId },
    });
    expect(line.isUpsell).toBe(true);
    expect(line.discountPercentage.isZero()).toBe(true);

    const rec = await prisma.upsellRecommendation.findFirstOrThrow({
      where: { quotationId: q.id, productId: warrantyId },
    });
    expect(rec.status).toBe("ACCEPTED");
  });

  it("records a dismissal", async () => {
    const q = await cartWithLaptop();
    await getUpsellSuggestions(q.id);

    expect(await dismissUpsell({ quotationId: q.id, productId: warrantyId })).toBe(1);
    const rec = await prisma.upsellRecommendation.findFirstOrThrow({
      where: { quotationId: q.id, productId: warrantyId },
    });
    expect(rec.status).toBe("DISMISSED");
  });
});

/**
 * The demo beat worth showing live.
 *
 * A high-margin upsell closes the margin gap, so the risk score *falls* - while
 * the ceiling breach elsewhere keeps approval required. That is the clearest
 * proof the two approval triggers are genuinely independent rules rather than
 * one condition wearing a costume.
 */
describe("accepting a high-margin upsell lowers risk without clearing approval", () => {
  it("drops the score while approval stays required", async () => {
    const q = await createQuotation({ customerId: acmeId, salesRepId: repId });
    created.push(q.id);
    await addQuotationLine({
      quotationId: q.id,
      productId: laptopId,
      quantity: 10,
      discountPercentage: "12.00",
    });
    // Services ceiling is 10% for Gold, so 18% breaches it.
    await addQuotationLine({
      quotationId: q.id,
      productId: setupId,
      quantity: 1,
      discountPercentage: "18.00",
    });

    const before = await recomputeQuotation(q.id);
    expect(before.riskScore).toBe(30);
    expect(before.riskLevel).toBe("MEDIUM");
    expect(before.approvalRequired).toBe(true);

    await getUpsellSuggestions(q.id);
    await acceptUpsell({ quotationId: q.id, productId: warrantyId });
    const after = await recomputeQuotation(q.id);

    // Margin exposure closes: 22.0% -> 29.6% against a 30% target.
    expect(after.marginPercentage.greaterThan(before.marginPercentage)).toBe(true);
    expect(after.riskScore).toBe(20);
    expect(after.riskLevel).toBe("LOW");

    // But the Setup Service line is still over its ceiling, so a human still
    // has to look at it.
    expect(after.approvalRequired).toBe(true);
    expect(after.approvalReason).toContain("ceiling");

    const marginFactor = after.riskFactors.find((f) => f.source === "MARGIN_EXPOSURE")!;
    expect(marginFactor.points).toBe(0);
    const ceilingFactor = after.riskFactors.find((f) => f.source === "CATEGORY_VIOLATION")!;
    expect(ceilingFactor.points).toBe(20);
  });
});
