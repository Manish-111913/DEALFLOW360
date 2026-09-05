import { describe, expect, it } from "vitest";
import { computeLineMargin, computeOrderMargin, marginPercentageOf } from "./margin";
import { Prisma } from "../generated/prisma/client";

/**
 * Pure tests. Nothing here touches the database — the engine takes numbers and
 * returns numbers, which is the whole point of keeping it free of the ORM.
 */

const D = (v: string | number) => new Prisma.Decimal(v);

/** The worked example frozen in 03_BUSINESS_RULES.md. */
const LAPTOP_LINE = {
  label: "Laptop Pro",
  quantity: 10,
  unitPrice: "5000.00",
  discountPercentage: "12.00",
  unitCost: "3200.00",
};

describe("the frozen worked example", () => {
  it("computes every intermediate value exactly", () => {
    const r = computeLineMargin(LAPTOP_LINE);

    expect(r.subtotal.equals(D("50000"))).toBe(true);
    expect(r.discountAmount.equals(D("6000"))).toBe(true);
    expect(r.netSellingValue.equals(D("44000"))).toBe(true);
    expect(r.estimatedCost.equals(D("32000"))).toBe(true);
    expect(r.grossMargin.equals(D("12000"))).toBe(true);
    expect(r.marginPercentage.toFixed(1)).toBe("27.3");
  });

  // 12000 / 44000 = 27.2727...%, stored at 2dp and displayed at 1dp. Asserting
  // both keeps the stored value honest and the demo figure recognisable.
  it("stores 27.27 and displays 27.3", () => {
    const r = computeLineMargin(LAPTOP_LINE);
    expect(r.marginPercentage.toFixed(2)).toBe("27.27");
    expect(r.marginPercentage.toFixed(1)).toBe("27.3");
  });

  it("raising the discount to 18% drops margin to 22.0%", () => {
    const r = computeLineMargin({ ...LAPTOP_LINE, discountPercentage: "18.00" });

    expect(r.discountAmount.equals(D("9000"))).toBe(true);
    expect(r.netSellingValue.equals(D("41000"))).toBe(true);
    expect(r.grossMargin.equals(D("9000"))).toBe(true);
    expect(r.marginPercentage.toFixed(1)).toBe("22.0");
  });

  // Adding proportional volume changes the money but not the ratio. Only a
  // discount or a cost change moves margin percentage.
  it("adding one more unit at the same discount leaves margin percentage unchanged", () => {
    const ten = computeLineMargin(LAPTOP_LINE);
    const eleven = computeLineMargin({ ...LAPTOP_LINE, quantity: 11 });

    expect(eleven.subtotal.equals(D("55000"))).toBe(true);
    expect(eleven.discountAmount.equals(D("6600"))).toBe(true);
    expect(eleven.netSellingValue.equals(D("48400"))).toBe(true);
    expect(eleven.estimatedCost.equals(D("35200"))).toBe(true);
    expect(eleven.grossMargin.equals(D("13200"))).toBe(true);
    expect(eleven.marginPercentage.toFixed(1)).toBe(ten.marginPercentage.toFixed(1));
    expect(eleven.marginPercentage.toFixed(1)).toBe("27.3");
  });
});

describe("division-by-zero guard", () => {
  it("defines margin percentage as 0 when net selling value is 0", () => {
    expect(marginPercentageOf(D("-100"), D("0")).isZero()).toBe(true);
  });

  // A 100% discount is a legitimate thing for a rep to type. Refusing to
  // compute would block the very quote the risk engine needs to flag.
  it("handles a fully discounted line without throwing", () => {
    const r = computeLineMargin({ ...LAPTOP_LINE, discountPercentage: "100.00" });

    expect(r.netSellingValue.isZero()).toBe(true);
    expect(r.grossMargin.equals(D("-32000"))).toBe(true);
    expect(r.marginPercentage.isZero()).toBe(true);
  });

  it("returns zeroes for an empty order rather than NaN", () => {
    const r = computeOrderMargin([]);

    expect(r.subtotal.isZero()).toBe(true);
    expect(r.netSellingValue.isZero()).toBe(true);
    expect(r.marginPercentage.isZero()).toBe(true);
  });
});

describe("negative margin is reported, not hidden", () => {
  it("computes a loss-making line honestly", () => {
    const r = computeLineMargin({
      quantity: 1,
      unitPrice: "1000.00",
      discountPercentage: "50.00",
      unitCost: "800.00",
    });

    expect(r.netSellingValue.equals(D("500"))).toBe(true);
    expect(r.grossMargin.equals(D("-300"))).toBe(true);
    expect(r.marginPercentage.toFixed(1)).toBe("-60.0");
  });
});

describe("whole-order aggregation", () => {
  // Matches the seeded catalogue: the two-line order the demo opens with.
  const DEMO_ORDER = [
    LAPTOP_LINE,
    {
      label: "Setup Service",
      quantity: 1,
      unitPrice: "20000.00",
      discountPercentage: "18.00",
      unitCost: "15100.00",
    },
  ];

  it("reproduces the demo order's 22.0% margin", () => {
    const r = computeOrderMargin(DEMO_ORDER);

    expect(r.subtotal.equals(D("70000"))).toBe(true);
    expect(r.netSellingValue.equals(D("60400"))).toBe(true);
    expect(r.estimatedCost.equals(D("47100"))).toBe(true);
    expect(r.grossMargin.equals(D("13300"))).toBe(true);
    expect(r.marginPercentage.toFixed(1)).toBe("22.0");
  });

  it("keeps the order at 22.0% when Onboarding Training is added", () => {
    const r = computeOrderMargin([
      ...DEMO_ORDER,
      {
        label: "Onboarding Training",
        quantity: 1,
        unitPrice: "15000.00",
        discountPercentage: "13.00",
        unitCost: "10179.00",
      },
    ]);

    expect(r.netSellingValue.equals(D("73450"))).toBe(true);
    expect(r.estimatedCost.equals(D("57279"))).toBe(true);
    expect(r.marginPercentage.toFixed(1)).toBe("22.0");
  });

  it("returns per-line results alongside the order total", () => {
    const r = computeOrderMargin(DEMO_ORDER);

    expect(r.lines).toHaveLength(2);
    expect(r.lines[0].label).toBe("Laptop Pro");
    expect(r.lines[0].netSellingValue.equals(D("44000"))).toBe(true);
    expect(r.lines[1].netSellingValue.equals(D("16400"))).toBe(true);
  });

  it("order totals equal the sum of the line totals", () => {
    const r = computeOrderMargin(DEMO_ORDER);
    const summed = r.lines.reduce((acc, l) => acc.plus(l.netSellingValue), D(0));

    expect(r.netSellingValue.equals(summed)).toBe(true);
  });
});

describe("D22 — the result explains itself", () => {
  it("shows the derivation, not just the number", () => {
    const r = computeOrderMargin([LAPTOP_LINE]);

    expect(r.explain.label).toBe("Gross margin");
    expect(r.explain.value).toBe("12000.00");
    expect(r.explain.sources).toContain("03_BUSINESS_RULES.md - Margin Engine");

    const labels = r.explain.steps.map((s) => s.label);
    expect(labels).toEqual([
      "Subtotal",
      "Discount",
      "Net selling value",
      "Estimated cost",
      "Gross margin",
      "Margin percentage",
    ]);

    const netStep = r.explain.steps.find((s) => s.label === "Net selling value");
    expect(netStep?.formula).toBe("50000.00 - 6000.00");
    expect(netStep?.value).toBe("44000.00");

    const pctStep = r.explain.steps.find((s) => s.label === "Margin percentage");
    expect(pctStep?.formula).toBe("12000.00 / 44000.00 x 100");
  });

  it("says so plainly when the zero guard fires", () => {
    const r = computeOrderMargin([{ ...LAPTOP_LINE, discountPercentage: "100.00" }]);
    const pctStep = r.explain.steps.find((s) => s.label === "Margin percentage");

    expect(pctStep?.formula).toMatch(/defined as 0%/);
  });
});

describe("D2 — money is exact, not floating point", () => {
  // 0.1 + 0.2 territory: a float implementation drifts here, a Decimal one
  // does not. This is why every monetary field is Decimal end to end.
  it("does not accumulate rounding error across many small lines", () => {
    const lines = Array.from({ length: 300 }, () => ({
      quantity: 1,
      unitPrice: "0.10",
      discountPercentage: "0.00",
      unitCost: "0.00",
    }));

    const r = computeOrderMargin(lines);
    expect(r.subtotal.toFixed(2)).toBe("30.00");
    expect(r.subtotal.equals(D("30"))).toBe(true);
  });

  it("rounds half-up at the money boundary", () => {
    const r = computeLineMargin({
      quantity: 1,
      unitPrice: "10.005",
      discountPercentage: "0.00",
      unitCost: "0.00",
    });

    expect(r.subtotal.toFixed(2)).toBe("10.01");
  });
});
