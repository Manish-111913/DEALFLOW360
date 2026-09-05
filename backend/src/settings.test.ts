import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "./generated/prisma/client";
import { auditTrailFor } from "./audit";
import { prisma } from "./db";
import { computeOrderMargin } from "./engines/margin";
import { ValidationError } from "./errors";
import {
  __clearSettingsCacheForTests,
  ensureDefaultSettings,
  getSettings,
  refreshSettings,
  SETTING_DEFAULTS,
  SETTING_KEYS,
  setSetting,
} from "./settings";
import {
  addQuotationLine,
  createQuotation,
  recomputeQuotation,
} from "./services/quotations";

const D = (v: string | number) => new Prisma.Decimal(v);

let acmeId: string;
let repId: string;
let laptopId: string;
const createdQuotations: string[] = [];

async function newQuotation() {
  const q = await createQuotation({ customerId: acmeId, salesRepId: repId });
  createdQuotations.push(q.id);
  return q;
}

beforeAll(async () => {
  acmeId = (await prisma.customer.findUniqueOrThrow({ where: { name: "Acme Industries" } })).id;
  repId = (await prisma.user.findUniqueOrThrow({ where: { email: "priya@dealflow360.test" } })).id;
  laptopId = (await prisma.product.findUniqueOrThrow({ where: { sku: "HW-LAPTOP-PRO" } })).id;
});

afterEach(async () => {
  // Settings are global state; put them back so ordering cannot matter.
  for (const key of Object.values(SETTING_KEYS)) {
    await prisma.systemSetting.updateMany({
      where: { key },
      data: { value: SETTING_DEFAULTS[key] },
    });
  }
  await prisma.tax.updateMany({ where: { name: "GST 18%" }, data: { percentage: "18.00" } });
  await refreshSettings();
});

afterAll(async () => {
  await prisma.quotation.deleteMany({ where: { id: { in: createdQuotations } } });
  await prisma.$disconnect();
});

describe("defaults", () => {
  // A missing settings row must never be the reason a quotation cannot be
  // priced, so every key resolves with the table empty.
  it("resolves every key with no rows in the table", async () => {
    const saved = await prisma.systemSetting.findMany();
    await prisma.systemSetting.deleteMany({});
    __clearSettingsCacheForTests();

    try {
      const s = await getSettings();
      expect(s.currencyCode).toBe("INR");
      expect(s.currencyMinorUnits).toBe(2);
      expect(s.quoteNumberPrefix).toBe("Q");
      expect(s.quoteNumberPadding).toBe(4);
      expect(s.targetMarginPercentage.equals(D(30))).toBe(true);
    } finally {
      for (const row of saved) {
        await prisma.systemSetting.create({ data: row });
      }
      await refreshSettings();
    }
  });

  it("ensureDefaultSettings is idempotent", async () => {
    const written = await ensureDefaultSettings();
    expect(written).toBe(0);
  });
});

describe("validation refuses values that would corrupt a calculation", () => {
  it("rejects a non-ISO currency code", async () => {
    await expect(
      setSetting({ key: SETTING_KEYS.currencyCode, value: "rupees" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects impossible currency precision", async () => {
    await expect(
      setSetting({ key: SETTING_KEYS.currencyMinorUnits, value: "9" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      setSetting({ key: SETTING_KEYS.currencyMinorUnits, value: "-1" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a target margin outside 0..100", async () => {
    await expect(
      setSetting({ key: SETTING_KEYS.targetMarginPercentage, value: "140" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("accepts a valid change", async () => {
    await setSetting({ key: SETTING_KEYS.currencyCode, value: "USD" });
    expect((await getSettings()).currencyCode).toBe("USD");
  });
});

describe("settings changes are audited", () => {
  it("records the before and after", async () => {
    await setSetting({
      key: SETTING_KEYS.targetMarginPercentage,
      value: "35",
      reason: "Board raised the margin target",
    });

    const trail = await auditTrailFor("SystemSetting", SETTING_KEYS.targetMarginPercentage);
    const last = trail.at(-1);

    expect(last?.action).toBe("CONFIGURE");
    expect(last?.reason).toBe("Board raised the margin target");
    expect(last?.fieldChanges).toEqual({ value: { before: "30", after: "35" } });
  });
});

describe("currency precision drives rounding, rather than a constant", () => {
  // A zero-decimal currency (JPY) must not silently round to 2 places. The
  // engine takes precision as a parameter precisely so this is possible.
  it("rounds to whole units when the currency has none", () => {
    const line = {
      quantity: 3,
      unitPrice: "333.33",
      discountPercentage: "0.00",
      unitCost: "100.00",
    };

    const inr = computeOrderMargin([line], { minorUnits: 2 });
    const jpy = computeOrderMargin([line], { minorUnits: 0 });

    expect(inr.subtotal.toFixed(2)).toBe("999.99");
    expect(jpy.subtotal.toFixed(0)).toBe("1000");
  });

  it("formats its explanation at the same precision", () => {
    const r = computeOrderMargin(
      [{ quantity: 1, unitPrice: "100", discountPercentage: "0", unitCost: "40" }],
      { minorUnits: 0 },
    );
    expect(r.explain.value).toBe("60");
  });

  it("defaults to 2 places when no precision is given", () => {
    const r = computeOrderMargin([
      { quantity: 1, unitPrice: "100", discountPercentage: "0", unitCost: "40" },
    ]);
    expect(r.explain.value).toBe("60.00");
  });
});

describe("quote number format is configuration", () => {
  it("uses the configured prefix and padding", async () => {
    await setSetting({ key: SETTING_KEYS.quoteNumberPrefix, value: "SO" });
    await setSetting({ key: SETTING_KEYS.quoteNumberPadding, value: "6" });

    const q = await newQuotation();
    expect(q.quoteNumber).toMatch(/^SO-\d{4}-\d{6}$/);
  });

  it("rejects a prefix that would not fit a document number", async () => {
    await expect(
      setSetting({ key: SETTING_KEYS.quoteNumberPrefix, value: "way too long" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

/**
 * Commercial terms are snapshotted; statutory rates are not.
 *
 * Price and cost freeze when a line is added, so a catalogue change cannot
 * reprice a quote a customer is looking at. A tax rate is not a commercial
 * term — if GST changes, a draft should bill at the new rate. Once the quote
 * has been sent, the total the customer saw is honoured and the rate freezes
 * too.
 */
describe("tax tracks the current rate while a quotation is a draft", () => {
  it("follows a rate change on a draft", async () => {
    const q = await newQuotation();
    await addQuotationLine({
      quotationId: q.id,
      productId: laptopId,
      quantity: 10,
      discountPercentage: "12.00",
    });

    let saved = await prisma.quotation.findUniqueOrThrow({ where: { id: q.id } });
    expect(saved.taxAmount.equals(D("7920"))).toBe(true); // 44,000 at 18%

    await prisma.tax.updateMany({ where: { name: "GST 18%" }, data: { percentage: "5.00" } });
    await recomputeQuotation(q.id);

    saved = await prisma.quotation.findUniqueOrThrow({ where: { id: q.id } });
    expect(saved.taxAmount.equals(D("2200"))).toBe(true); // 44,000 at 5%
    expect(saved.totalAmount.equals(D("46200"))).toBe(true);

    // Margin is untouched by any of it: tax is never revenue.
    expect(saved.grossMargin.equals(D("12000"))).toBe(true);
    expect(saved.marginPercentage.toFixed(1)).toBe("27.3");
  });

  it("freezes once the quotation has been sent", async () => {
    const q = await newQuotation();
    await addQuotationLine({
      quotationId: q.id,
      productId: laptopId,
      quantity: 10,
      discountPercentage: "12.00",
    });

    await prisma.quotation.update({ where: { id: q.id }, data: { status: "SENT" } });

    await prisma.tax.updateMany({ where: { name: "GST 18%" }, data: { percentage: "5.00" } });
    await recomputeQuotation(q.id);

    const saved = await prisma.quotation.findUniqueOrThrow({ where: { id: q.id } });
    // Still the 18% the customer was shown.
    expect(saved.taxAmount.equals(D("7920"))).toBe(true);
  });
});

describe("target margin is configuration, ready for the risk engine", () => {
  it("is readable and changeable", async () => {
    expect((await getSettings()).targetMarginPercentage.equals(D(30))).toBe(true);

    await setSetting({ key: SETTING_KEYS.targetMarginPercentage, value: "40" });
    expect((await getSettings()).targetMarginPercentage.equals(D(40))).toBe(true);
  });
});
