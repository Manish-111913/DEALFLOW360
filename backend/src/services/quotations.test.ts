import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "../generated/prisma/client";
import { auditTrailFor } from "../audit";
import { prisma } from "../db";
import { ValidationError } from "../errors";
import type { AuthzUser } from "../authz/roles";
import {
  addQuotationLine,
  createQuotation,
  getQuotation,
  recomputeQuotation,
  removeQuotationLine,
  updateQuotationLine,
} from "./quotations";

const D = (v: string | number) => new Prisma.Decimal(v);

let acmeId: string;
let repId: string;

/** getQuotation returns costs and line margins, so it needs an internal reader. */
let reader: AuthzUser;
let laptopId: string;
let setupId: string;
const createdQuotations: string[] = [];

async function newQuotation() {
  const q = await createQuotation({ customerId: acmeId, salesRepId: repId });
  createdQuotations.push(q.id);
  return q;
}

beforeAll(async () => {
  acmeId = (await prisma.customer.findUniqueOrThrow({ where: { name: "Acme Industries" } })).id;
  repId = (await prisma.user.findUniqueOrThrow({ where: { email: "priya@dealflow360.test" } })).id;
  reader = { id: repId, kind: "INTERNAL", role: "SALES_MANAGER", customerId: null };
  laptopId = (await prisma.product.findUniqueOrThrow({ where: { sku: "HW-LAPTOP-PRO" } })).id;
  setupId = (await prisma.product.findUniqueOrThrow({ where: { sku: "SV-SETUP" } })).id;
});

afterAll(async () => {
  // Lines cascade. Audit rows survive by design — they reference the quotation
  // by name and id, not by foreign key, so history outlives the record.
  await prisma.quotation.deleteMany({ where: { id: { in: createdQuotations } } });
  await prisma.$disconnect();
});

describe("creating a quotation", () => {
  it("refuses a customer with no tier", async () => {
    const tierless = await prisma.customer.create({
      data: {
        name: `Quotation Tierless ${createdQuotations.length}-${Math.random()}`,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    });

    try {
      await expect(
        createQuotation({ customerId: tierless.id, salesRepId: repId }),
      ).rejects.toBeInstanceOf(ValidationError);
    } finally {
      await prisma.customer.delete({ where: { id: tierless.id } });
    }
  });

  it("issues sequential, readable quote numbers", async () => {
    const a = await newQuotation();
    const b = await newQuotation();

    expect(a.quoteNumber).toMatch(/^Q-\d{4}-\d{4}$/);
    const seqA = Number(a.quoteNumber.split("-")[2]);
    const seqB = Number(b.quoteNumber.split("-")[2]);
    expect(seqB).toBe(seqA + 1);
  });

  it("starts empty, at zero, with no approval state", async () => {
    const q = await newQuotation();

    expect(q.subtotal.isZero()).toBe(true);
    expect(q.marginPercentage.isZero()).toBe(true);
    expect(q.approvalState).toBe("NONE");
    expect(q.portalStatus).toBe("NOT_SHARED");
    expect(q.status).toBe("DRAFT");
  });
});

describe("the frozen scenario, end to end through the database", () => {
  it("10 units of Laptop Pro at 12% produces the documented figures", async () => {
    const q = await newQuotation();
    await addQuotationLine({
      quotationId: q.id,
      productId: laptopId,
      quantity: 10,
      discountPercentage: "12.00",
    });

    const saved = await prisma.quotation.findUniqueOrThrow({ where: { id: q.id } });

    // Unit price 5,000 comes from the Gold price list, not the 5,400 base.
    expect(saved.subtotal.equals(D("50000"))).toBe(true);
    expect(saved.discountAmount.equals(D("6000"))).toBe(true);
    expect(saved.totalCost.equals(D("32000"))).toBe(true);
    expect(saved.grossMargin.equals(D("12000"))).toBe(true);
    expect(saved.marginPercentage.toFixed(1)).toBe("27.3");
  });

  it("raising the discount to 18% drops margin to 22.0%", async () => {
    const q = await newQuotation();
    const line = await addQuotationLine({
      quotationId: q.id,
      productId: laptopId,
      quantity: 10,
      discountPercentage: "12.00",
    });

    await updateQuotationLine({ lineId: line.id, discountPercentage: "18.00" });
    const saved = await prisma.quotation.findUniqueOrThrow({ where: { id: q.id } });

    expect(saved.discountAmount.equals(D("9000"))).toBe(true);
    expect(saved.grossMargin.equals(D("9000"))).toBe(true);
    expect(saved.marginPercentage.toFixed(1)).toBe("22.0");
  });

  it("the demo's two-line order lands at 22.0%", async () => {
    const q = await newQuotation();
    await addQuotationLine({
      quotationId: q.id,
      productId: laptopId,
      quantity: 10,
      discountPercentage: "12.00",
    });
    await addQuotationLine({
      quotationId: q.id,
      productId: setupId,
      quantity: 1,
      discountPercentage: "18.00",
    });

    const saved = await prisma.quotation.findUniqueOrThrow({ where: { id: q.id } });

    expect(saved.subtotal.equals(D("70000"))).toBe(true);
    expect(saved.totalCost.equals(D("47100"))).toBe(true);
    expect(saved.grossMargin.equals(D("13300"))).toBe(true);
    expect(saved.marginPercentage.toFixed(1)).toBe("22.0");
  });
});

describe("D21 — every mutation runs the same recompute", () => {
  it("recomputes on add, on edit, and on remove", async () => {
    const q = await newQuotation();

    const first = await addQuotationLine({
      quotationId: q.id,
      productId: laptopId,
      quantity: 10,
      discountPercentage: "12.00",
    });
    let saved = await prisma.quotation.findUniqueOrThrow({ where: { id: q.id } });
    expect(saved.grossMargin.equals(D("12000"))).toBe(true);

    const second = await addQuotationLine({
      quotationId: q.id,
      productId: setupId,
      quantity: 1,
      discountPercentage: "18.00",
    });
    saved = await prisma.quotation.findUniqueOrThrow({ where: { id: q.id } });
    expect(saved.grossMargin.equals(D("13300"))).toBe(true);

    await updateQuotationLine({ lineId: first.id, quantity: 20 });
    saved = await prisma.quotation.findUniqueOrThrow({ where: { id: q.id } });
    expect(saved.subtotal.equals(D("120000"))).toBe(true);

    await removeQuotationLine(second.id);
    saved = await prisma.quotation.findUniqueOrThrow({ where: { id: q.id } });
    expect(saved.subtotal.equals(D("100000"))).toBe(true);
    expect(saved.marginPercentage.toFixed(1)).toBe("27.3");
  });

  it("writes line-level results, not only order totals", async () => {
    const q = await newQuotation();
    await addQuotationLine({
      quotationId: q.id,
      productId: laptopId,
      quantity: 10,
      discountPercentage: "12.00",
    });

    const full = await getQuotation(reader, q.id);
    const line = full!.lines[0];

    expect(line.lineSubtotal.equals(D("50000"))).toBe(true);
    expect(line.lineTotal.equals(D("44000"))).toBe(true);
    expect(line.marginAmount.equals(D("12000"))).toBe(true);
    expect(line.marginPercentage.toFixed(1)).toBe("27.3");
  });

  it("order totals equal the sum of line totals", async () => {
    const q = await newQuotation();
    await addQuotationLine({ quotationId: q.id, productId: laptopId, quantity: 3, discountPercentage: "7.00" });
    await addQuotationLine({ quotationId: q.id, productId: setupId, quantity: 2, discountPercentage: "11.00" });

    const full = await getQuotation(reader, q.id);
    const summed = full!.lines.reduce((acc, l) => acc.plus(l.lineTotal), D(0));
    const saved = await prisma.quotation.findUniqueOrThrow({ where: { id: q.id } });

    expect(saved.subtotal.minus(saved.discountAmount).equals(summed)).toBe(true);
  });

  it("is idempotent — recomputing again changes nothing", async () => {
    const q = await newQuotation();
    await addQuotationLine({ quotationId: q.id, productId: laptopId, quantity: 10, discountPercentage: "12.00" });

    const before = await prisma.quotation.findUniqueOrThrow({ where: { id: q.id } });
    await recomputeQuotation(q.id);
    const after = await prisma.quotation.findUniqueOrThrow({ where: { id: q.id } });

    expect(after.subtotal.equals(before.subtotal)).toBe(true);
    expect(after.grossMargin.equals(before.grossMargin)).toBe(true);
    expect(after.marginPercentage.equals(before.marginPercentage)).toBe(true);
  });
});

describe("tax is carried, but never counted as margin", () => {
  it("adds 18% GST to the total while leaving margin untouched", async () => {
    const q = await newQuotation();
    await addQuotationLine({
      quotationId: q.id,
      productId: laptopId,
      quantity: 10,
      discountPercentage: "12.00",
    });

    const saved = await prisma.quotation.findUniqueOrThrow({ where: { id: q.id } });

    // Net 44,000 at 18% = 7,920 tax, so the customer pays 51,920.
    expect(saved.taxAmount.equals(D("7920"))).toBe(true);
    expect(saved.totalAmount.equals(D("51920"))).toBe(true);

    // Margin is unchanged by any of that: tax is collected for the state, so it
    // is neither revenue nor margin.
    expect(saved.grossMargin.equals(D("12000"))).toBe(true);
    expect(saved.marginPercentage.toFixed(1)).toBe("27.3");
  });
});

describe("price and cost are snapshotted onto the line", () => {
  it("uses the customer's tier price rather than the base price", async () => {
    const q = await newQuotation();
    const line = await addQuotationLine({
      quotationId: q.id,
      productId: laptopId,
      quantity: 1,
    });

    // Acme is Gold: 5,000 from the price list, not the 5,400 base price.
    expect(line.unitPrice.equals(D("5000"))).toBe(true);
    expect(line.unitCost.equals(D("3200"))).toBe(true);
  });

  it("records an explicit price override as a commercial act", async () => {
    const q = await newQuotation();
    const line = await addQuotationLine({
      quotationId: q.id,
      productId: laptopId,
      quantity: 1,
      unitPriceOverride: "4800.00",
    });

    expect(line.unitPrice.equals(D("4800"))).toBe(true);

    const trail = await auditTrailFor("Quotation", q.id);
    const added = trail.find((e) => e.reason?.startsWith("Line added"));
    expect((added?.fieldChanges as Record<string, unknown>).unitPriceOverridden).toBe(true);
  });
});

describe("input validation", () => {
  it("rejects a non-positive quantity", async () => {
    const q = await newQuotation();
    await expect(
      addQuotationLine({ quotationId: q.id, productId: laptopId, quantity: 0 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a discount above 100 percent", async () => {
    const q = await newQuotation();
    await expect(
      addQuotationLine({
        quotationId: q.id,
        productId: laptopId,
        quantity: 1,
        discountPercentage: "120.00",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("edits are audited", () => {
  it("records creation, addition, edit and removal", async () => {
    const q = await newQuotation();
    const line = await addQuotationLine({
      quotationId: q.id,
      productId: laptopId,
      quantity: 10,
      discountPercentage: "12.00",
    });
    await updateQuotationLine({ lineId: line.id, discountPercentage: "18.00" });
    await removeQuotationLine(line.id);

    const trail = await auditTrailFor("Quotation", q.id);
    const reasons = trail.map((e) => e.reason ?? "");

    expect(reasons[0]).toBe("Quotation created");
    expect(reasons.some((r) => r.startsWith("Line added"))).toBe(true);
    expect(reasons.some((r) => r.startsWith("Line edited"))).toBe(true);
    expect(reasons.some((r) => r.startsWith("Line removed"))).toBe(true);
  });

  it("records the before and after of a discount change", async () => {
    const q = await newQuotation();
    const line = await addQuotationLine({
      quotationId: q.id,
      productId: laptopId,
      quantity: 1,
      discountPercentage: "5.00",
    });
    await updateQuotationLine({ lineId: line.id, discountPercentage: "25.00" });

    const trail = await auditTrailFor("Quotation", q.id);
    const edit = trail.find((e) => e.reason?.startsWith("Line edited"));
    const changes = edit?.fieldChanges as Record<string, { before: string; after: string }>;

    expect(changes.discountPercentage).toEqual({ before: "5.00", after: "25.00" });
  });

  // A trail full of "changed nothing" is harder to read, not more complete.
  it("writes no audit row for a no-op edit", async () => {
    const q = await newQuotation();
    const line = await addQuotationLine({
      quotationId: q.id,
      productId: laptopId,
      quantity: 4,
      discountPercentage: "10.00",
    });

    const before = (await auditTrailFor("Quotation", q.id)).length;
    await updateQuotationLine({ lineId: line.id, quantity: 4, discountPercentage: "10.00" });
    const after = (await auditTrailFor("Quotation", q.id)).length;

    expect(after).toBe(before);
  });
});
