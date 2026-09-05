import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "../generated/prisma/client";
import { resolveUnitPrice } from "./catalog";
import { prisma } from "../db";

afterAll(async () => {
  await prisma.$disconnect();
});

const D = (v: string | number) => new Prisma.Decimal(v);

async function laptop() {
  return prisma.product.findUniqueOrThrow({ where: { sku: "HW-LAPTOP-PRO" } });
}

describe("tier-based price resolution", () => {
  it("uses the Gold price list where one exists", async () => {
    const p = await laptop();
    const result = await resolveUnitPrice({ productId: p.id, tier: "GOLD" });

    expect(result.source).toBe("PRICE_LIST");
    expect(result.priceListName).toBe("Gold Tier Pricing");
    expect(result.unitPrice.equals(D("5000.00"))).toBe(true);
  });

  it("uses the Silver price list for a Silver customer", async () => {
    const p = await laptop();
    const result = await resolveUnitPrice({ productId: p.id, tier: "SILVER" });

    expect(result.source).toBe("PRICE_LIST");
    expect(result.unitPrice.equals(D("5200.00"))).toBe(true);
  });

  // The fallback matters as much as the hit: most products carry no tier price,
  // and silently returning zero for them would corrupt every margin downstream.
  it("falls back to base price for a tier with no price list", async () => {
    const p = await laptop();
    const result = await resolveUnitPrice({ productId: p.id, tier: "BRONZE" });

    expect(result.source).toBe("BASE_PRICE");
    expect(result.priceListName).toBeNull();
    expect(result.unitPrice.equals(D("5400.00"))).toBe(true);
  });

  it("falls back to base price for a customer with no tier at all", async () => {
    const p = await laptop();
    const result = await resolveUnitPrice({ productId: p.id, tier: null });

    expect(result.source).toBe("BASE_PRICE");
    expect(result.unitPrice.equals(D("5400.00"))).toBe(true);
  });

  it("falls back for a product absent from the tier's price list", async () => {
    const setup = await prisma.product.findUniqueOrThrow({ where: { sku: "SV-SETUP" } });
    const result = await resolveUnitPrice({ productId: setup.id, tier: "GOLD" });

    expect(result.source).toBe("BASE_PRICE");
    expect(result.unitPrice.equals(D("20000.00"))).toBe(true);
  });
});

describe("variant extra price", () => {
  it("adds the variant extra on top of a price-list price", async () => {
    const p = await laptop();
    const v32 = await prisma.productVariant.findUniqueOrThrow({
      where: { sku: "HW-LAPTOP-PRO-32" },
    });

    const result = await resolveUnitPrice({ productId: p.id, variantId: v32.id, tier: "GOLD" });

    expect(result.basePrice.equals(D("5000.00"))).toBe(true);
    expect(result.variantExtra.equals(D("800.00"))).toBe(true);
    expect(result.unitPrice.equals(D("5800.00"))).toBe(true);
  });

  it("adds nothing for the zero-extra variant", async () => {
    const p = await laptop();
    const v16 = await prisma.productVariant.findUniqueOrThrow({
      where: { sku: "HW-LAPTOP-PRO-16" },
    });

    const result = await resolveUnitPrice({ productId: p.id, variantId: v16.id, tier: "GOLD" });
    expect(result.unitPrice.equals(D("5000.00"))).toBe(true);
  });

  it("refuses a variant belonging to a different product", async () => {
    const setup = await prisma.product.findUniqueOrThrow({ where: { sku: "SV-SETUP" } });
    const v32 = await prisma.productVariant.findUniqueOrThrow({
      where: { sku: "HW-LAPTOP-PRO-32" },
    });

    await expect(
      resolveUnitPrice({ productId: setup.id, variantId: v32.id, tier: "GOLD" }),
    ).rejects.toThrow(/does not belong/i);
  });
});

describe("D22 — the resolved price explains itself", () => {
  it("reports the steps that produced the number", async () => {
    const p = await laptop();
    const v32 = await prisma.productVariant.findUniqueOrThrow({
      where: { sku: "HW-LAPTOP-PRO-32" },
    });

    const result = await resolveUnitPrice({ productId: p.id, variantId: v32.id, tier: "GOLD" });

    expect(result.steps.join(" | ")).toMatch(/Gold Tier Pricing/);
    expect(result.steps.join(" | ")).toMatch(/Variant adds 800\.00/);
    expect(result.steps.at(-1)).toBe("Unit price = 5800.00");
  });
});

/**
 * The seeded figures are load-bearing: the worked examples in
 * 03_BUSINESS_RULES.md must reproduce against real data, not only on paper.
 * The margin engine itself lands in B-3; this asserts the inputs it will read.
 */
describe("seed data reproduces the frozen worked examples", () => {
  it("Laptop Pro: 10 units at 12% gives net 44,000 and 27.3% margin", async () => {
    const p = await laptop();
    const price = (await resolveUnitPrice({ productId: p.id, tier: "GOLD" })).unitPrice;

    const subtotal = price.times(10);
    const discount = subtotal.times(D("0.12"));
    const net = subtotal.minus(discount);
    const cost = p.costPrice.times(10);
    const margin = net.minus(cost);

    expect(subtotal.equals(D("50000"))).toBe(true);
    expect(discount.equals(D("6000"))).toBe(true);
    expect(net.equals(D("44000"))).toBe(true);
    expect(cost.equals(D("32000"))).toBe(true);
    expect(margin.equals(D("12000"))).toBe(true);
    expect(margin.dividedBy(net).times(100).toFixed(1)).toBe("27.3");
  });

  it("Extended Warranty carries the 8,400 margin impact at 65%", async () => {
    const w = await prisma.product.findUniqueOrThrow({ where: { sku: "HW-WARRANTY-EXT" } });
    const margin = w.basePrice.minus(w.costPrice);

    expect(margin.equals(D("8400"))).toBe(true);
    expect(margin.dividedBy(w.basePrice).times(100).toFixed(1)).toBe("65.0");
  });

  it("the demo's two-line order lands at 22.0% margin", async () => {
    const p = await laptop();
    const setup = await prisma.product.findUniqueOrThrow({ where: { sku: "SV-SETUP" } });
    const laptopPrice = (await resolveUnitPrice({ productId: p.id, tier: "GOLD" })).unitPrice;

    const net = laptopPrice
      .times(10)
      .times(D("0.88"))
      .plus(setup.basePrice.times(D("0.82")));
    const cost = p.costPrice.times(10).plus(setup.costPrice);
    const margin = net.minus(cost);

    expect(net.equals(D("60400"))).toBe(true);
    expect(cost.equals(D("47100"))).toBe(true);
    expect(margin.dividedBy(net).times(100).toFixed(1)).toBe("22.0");
  });

  // Onboarding Training is priced so its own line margin is 22.0%, which keeps
  // the three-line order at 22.0% too — that is what lets the demo example and
  // the risk example quote the same figure without contradicting each other.
  it("adding Onboarding Training keeps the order at 22.0%", async () => {
    const p = await laptop();
    const setup = await prisma.product.findUniqueOrThrow({ where: { sku: "SV-SETUP" } });
    const onboard = await prisma.product.findUniqueOrThrow({ where: { sku: "SV-ONBOARD" } });
    const laptopPrice = (await resolveUnitPrice({ productId: p.id, tier: "GOLD" })).unitPrice;

    const net = laptopPrice
      .times(10)
      .times(D("0.88"))
      .plus(setup.basePrice.times(D("0.82")))
      .plus(onboard.basePrice.times(D("0.87")));
    const cost = p.costPrice.times(10).plus(setup.costPrice).plus(onboard.costPrice);
    const margin = net.minus(cost);

    expect(net.equals(D("73450"))).toBe(true);
    expect(cost.equals(D("57279"))).toBe(true);
    expect(margin.dividedBy(net).times(100).toFixed(1)).toBe("22.0");
  });
});

describe("catalogue completeness", () => {
  it("every product has a category and a cost, or margin cannot be computed", async () => {
    const products = await prisma.product.findMany({ include: { category: true } });

    expect(products.length).toBeGreaterThanOrEqual(5);
    for (const p of products) {
      expect(p.category.name).toBeTruthy();
      expect(p.costPrice.greaterThan(0)).toBe(true);
      expect(p.basePrice.greaterThan(p.costPrice)).toBe(true);
    }
  });

  it("covers the three categories the builder offers", async () => {
    const names = (await prisma.productCategory.findMany()).map((c) => c.name).sort();
    expect(names).toEqual(["Hardware", "Services", "Subscriptions"]);
  });
});
