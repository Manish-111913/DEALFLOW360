import { describe, expect, it } from "vitest";
import { Prisma } from "../generated/prisma/client";
import {
  buildSchedule,
  cancellationCredit,
  firstCycleCharge,
  midCycleQuantityDelta,
  nextPeriod,
  periodContaining,
  remainingDaysFrom,
} from "./billing";

const D = (v: string | number) => new Prisma.Decimal(v);

/** September 2026 has 30 days, which is what the worked example assumes. */
const SEP = (day: number) => new Date(Date.UTC(2026, 8, day));
const PLAN = "12000.00";

describe("the frozen worked example", () => {
  it("charges 6,400.00 for a subscription starting on the 15th of a 30-day month", () => {
    const first = firstCycleCharge({
      planAmount: PLAN,
      startDate: SEP(15),
      interval: "MONTHLY",
    });

    // 30 - 15 + 1 = 16 days used, so 12,000 x 16 / 30.
    expect(first.daysInPeriod).toBe(30);
    expect(first.daysCharged).toBe(16);
    expect(first.amount.toFixed(2)).toBe("6400.00");
    expect(first.amount.equals(D(6400))).toBe(true);
  });

  it("bills the next period in full", () => {
    const schedule = buildSchedule({
      planAmount: PLAN,
      startDate: SEP(15),
      interval: "MONTHLY",
      periods: 3,
    });

    expect(schedule[0].amount.toFixed(2)).toBe("6400.00");
    expect(schedule[1].amount.toFixed(2)).toBe("12000.00");
    expect(schedule[2].amount.toFixed(2)).toBe("12000.00");
  });

  it("bills on the first of each period, not on the start-date anniversary", () => {
    const schedule = buildSchedule({
      planAmount: PLAN,
      startDate: SEP(15),
      interval: "MONTHLY",
      periods: 3,
    });

    expect(schedule.map((s) => s.billingDate.toISOString().slice(0, 10))).toEqual([
      "2026-09-01",
      "2026-10-01",
      "2026-11-01",
    ]);
  });

  it("explains the proration rather than asserting it", () => {
    const first = firstCycleCharge({
      planAmount: PLAN,
      startDate: SEP(15),
      interval: "MONTHLY",
    });

    expect(first.explain.steps[0].formula).toBe("12000.00 x 16 / 30");
    expect(first.explain.value).toBe("6400.00");
  });

  it("does not prorate a subscription starting on the first day", () => {
    const first = firstCycleCharge({
      planAmount: PLAN,
      startDate: SEP(1),
      interval: "MONTHLY",
    });

    expect(first.daysCharged).toBe(30);
    expect(first.amount.toFixed(2)).toBe("12000.00");
    expect(first.explain.steps[0].label).toBe("Full period");
  });

  it("charges a single day when starting on the last day", () => {
    const first = firstCycleCharge({
      planAmount: PLAN,
      startDate: SEP(30),
      interval: "MONTHLY",
    });

    expect(first.daysCharged).toBe(1);
    expect(first.amount.toFixed(2)).toBe("400.00");
  });
});

/**
 * The change lands on the next invoice, never as a surprise bill outside the
 * normal cycle.
 */
describe("mid-cycle quantity change", () => {
  it("prorates a increase over the 10 days remaining in a 30-day period", () => {
    // The 21st of a 30-day month leaves 10 days including that day.
    const delta = midCycleQuantityDelta({
      unitPrice: PLAN,
      oldQuantity: 1,
      newQuantity: 2,
      changeDate: SEP(21),
      interval: "MONTHLY",
    });

    expect(delta.daysCharged).toBe(10);
    expect(delta.daysInPeriod).toBe(30);
    // 1 extra x 12,000 x 10 / 30
    expect(delta.amount.toFixed(2)).toBe("4000.00");
  });

  it("says plainly that it applies to the next invoice", () => {
    const delta = midCycleQuantityDelta({
      unitPrice: PLAN,
      oldQuantity: 1,
      newQuantity: 2,
      changeDate: SEP(21),
      interval: "MONTHLY",
    });

    const applied = delta.explain.steps.find((s) => s.label === "Applied to")!;
    expect(applied.formula).toContain("not raised immediately");
  });

  it("credits the next invoice when the quantity drops", () => {
    const delta = midCycleQuantityDelta({
      unitPrice: PLAN,
      oldQuantity: 3,
      newQuantity: 1,
      changeDate: SEP(21),
      interval: "MONTHLY",
    });

    expect(delta.amount.toFixed(2)).toBe("-8000.00");
  });

  it("scales with how much of the period is left", () => {
    const early = midCycleQuantityDelta({
      unitPrice: PLAN,
      oldQuantity: 1,
      newQuantity: 2,
      changeDate: SEP(2),
      interval: "MONTHLY",
    });
    const late = midCycleQuantityDelta({
      unitPrice: PLAN,
      oldQuantity: 1,
      newQuantity: 2,
      changeDate: SEP(29),
      interval: "MONTHLY",
    });

    expect(early.amount.greaterThan(late.amount)).toBe(true);
    expect(late.amount.toFixed(2)).toBe("800.00"); // 2 days of 30
  });
});

/**
 * Only the unused remainder of the current paid period is credited. Time
 * already delivered is not refunded.
 */
describe("cancellation credit", () => {
  it("credits the 10 unused days after cancelling on the 20th", () => {
    const credit = cancellationCredit({
      planAmount: PLAN,
      cancelDate: SEP(20),
      interval: "MONTHLY",
    });

    // The 20th is consumed, so the credit runs from the 21st to the 30th.
    expect(credit.daysCharged).toBe(10);
    expect(credit.amount.toFixed(2)).toBe("4000.00");
  });

  it("credits nothing when the period is already fully consumed", () => {
    const credit = cancellationCredit({
      planAmount: PLAN,
      cancelDate: SEP(30),
      interval: "MONTHLY",
    });

    expect(credit.daysCharged).toBe(0);
    expect(credit.amount.toFixed(2)).toBe("0.00");
  });

  // Never a negative credit: refunding beyond the period would be inventing money.
  it("is never negative", () => {
    for (const day of [1, 15, 29, 30]) {
      expect(
        cancellationCredit({ planAmount: PLAN, cancelDate: SEP(day), interval: "MONTHLY" })
          .amount.isNegative(),
      ).toBe(false);
    }
  });
});

describe("period arithmetic follows the real calendar", () => {
  it("uses the actual length of each month", () => {
    expect(periodContaining(new Date(Date.UTC(2026, 1, 10)), "MONTHLY").days).toBe(28);
    expect(periodContaining(new Date(Date.UTC(2028, 1, 10)), "MONTHLY").days).toBe(29); // leap
    expect(periodContaining(new Date(Date.UTC(2026, 3, 10)), "MONTHLY").days).toBe(30);
    expect(periodContaining(new Date(Date.UTC(2026, 0, 10)), "MONTHLY").days).toBe(31);
  });

  it("prorates a February start against 28 days, not a nominal 30", () => {
    const first = firstCycleCharge({
      planAmount: "2800.00",
      startDate: new Date(Date.UTC(2026, 1, 15)),
      interval: "MONTHLY",
    });

    expect(first.daysInPeriod).toBe(28);
    expect(first.daysCharged).toBe(14);
    expect(first.amount.toFixed(2)).toBe("1400.00");
  });

  it("handles quarters and years", () => {
    const q = periodContaining(new Date(Date.UTC(2026, 7, 15)), "QUARTERLY");
    expect(q.start.toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(q.end.toISOString().slice(0, 10)).toBe("2026-09-30");
    expect(q.days).toBe(92);

    const y = periodContaining(new Date(Date.UTC(2026, 7, 15)), "YEARLY");
    expect(y.days).toBe(365);
  });

  it("rolls over the year boundary", () => {
    const dec = periodContaining(new Date(Date.UTC(2026, 11, 5)), "MONTHLY");
    const jan = nextPeriod(dec, "MONTHLY");

    expect(jan.start.toISOString().slice(0, 10)).toBe("2027-01-01");
    expect(jan.days).toBe(31);
  });

  it("counts remaining days inclusively", () => {
    const september = periodContaining(SEP(1), "MONTHLY");
    expect(remainingDaysFrom(SEP(1), september)).toBe(30);
    expect(remainingDaysFrom(SEP(15), september)).toBe(16);
    expect(remainingDaysFrom(SEP(30), september)).toBe(1);
  });
});

describe("schedules carry quantity and a proration note", () => {
  it("multiplies by quantity", () => {
    const schedule = buildSchedule({
      planAmount: PLAN,
      quantity: 3,
      startDate: SEP(1),
      interval: "MONTHLY",
      periods: 2,
    });

    expect(schedule[0].amount.toFixed(2)).toBe("36000.00");
  });

  it("notes only the periods that are actually prorated", () => {
    const schedule = buildSchedule({
      planAmount: PLAN,
      startDate: SEP(15),
      interval: "MONTHLY",
      periods: 2,
    });

    expect(schedule[0].prorationNote).toContain("16 of 30 days");
    expect(schedule[1].prorationNote).toBeNull();
  });

  it("starts the first period on the start date when it is partial", () => {
    const schedule = buildSchedule({
      planAmount: PLAN,
      startDate: SEP(15),
      interval: "MONTHLY",
      periods: 1,
    });

    expect(schedule[0].periodStart.toISOString().slice(0, 10)).toBe("2026-09-15");
    expect(schedule[0].periodEnd.toISOString().slice(0, 10)).toBe("2026-09-30");
  });
});
