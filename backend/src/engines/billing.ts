import { Prisma } from "../generated/prisma/client";
import type { BillingInterval } from "../generated/prisma/enums";
import { type Explanation, step } from "./explain";
import type { DecimalValue } from "./margin";

/**
 * The Hybrid Billing engine, frozen in 03_BUSINESS_RULES.md.
 *
 * ---------------------------------------------------------------------------
 * CALENDAR-ALIGNED CYCLES
 * ---------------------------------------------------------------------------
 * Every recurring line bills on the first day of its period, not on the
 * anniversary of its own start date. That is a deliberate simplification: it
 * means proration is always meaningful, every subscription on the system bills
 * on the same day, and the demo is deterministic.
 *
 * The cost of that choice is a partial first period, which is exactly what the
 * first-cycle proration below exists to handle:
 *
 *     12,000/month starting on the 15th of a 30-day month
 *     remaining days, inclusive of the start = 30 - 15 + 1 = 16
 *     first charge = 12,000 x 16 / 30 = 6,400.00
 *
 * ---------------------------------------------------------------------------
 * PURE
 * ---------------------------------------------------------------------------
 * No database, no clock, no I/O. Every function takes the dates it needs, so
 * the caller supplies time from currentBusinessTime() (D3) and the demo can
 * move the clock without this file knowing.
 *
 * All dates are treated in UTC. Mixing local time in would make a period
 * boundary depend on the server's timezone, which is how billing quietly bills
 * a day early for half the year.
 */

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

const DAY_MS = 86_400_000;

/** D2 - half-up at the money boundary. */
function money(value: Decimal, minorUnits = 2): Decimal {
  return value.toDecimalPlaces(minorUnits, Decimal.ROUND_HALF_UP);
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

export interface BillingPeriod {
  /** First day of the period, at UTC midnight. */
  start: Date;
  /** Last day of the period, at UTC midnight. */
  end: Date;
  /** Inclusive day count: a 30-day month is 30, not 29. */
  days: number;
}

function utcMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

function inclusiveDays(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
}

/** The period a date falls inside, for the given interval. */
export function periodContaining(date: Date, interval: BillingInterval): BillingPeriod {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();

  if (interval === "YEARLY") {
    const start = utcMidnight(year, 0, 1);
    const end = utcMidnight(year, 11, 31);
    return { start, end, days: inclusiveDays(start, end) };
  }

  if (interval === "QUARTERLY") {
    const firstMonth = Math.floor(month / 3) * 3;
    const start = utcMidnight(year, firstMonth, 1);
    // Day 0 of the next month is the last day of this one.
    const end = utcMidnight(year, firstMonth + 3, 0);
    return { start, end, days: inclusiveDays(start, end) };
  }

  const start = utcMidnight(year, month, 1);
  const end = utcMidnight(year, month + 1, 0);
  return { start, end, days: inclusiveDays(start, end) };
}

/** The period immediately after this one. */
export function nextPeriod(period: BillingPeriod, interval: BillingInterval): BillingPeriod {
  const dayAfter = new Date(period.end.getTime() + DAY_MS);
  return periodContaining(dayAfter, interval);
}

/**
 * Days remaining in a period, counting the given day itself.
 *
 * A subscription starting on the 15th is used on the 15th, so the 15th is
 * billed. Counting exclusively would give 15 days and a charge of 6,000 rather
 * than the documented 6,400.
 */
export function remainingDaysFrom(date: Date, period: BillingPeriod): number {
  const day = utcMidnight(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  if (day.getTime() > period.end.getTime()) return 0;
  if (day.getTime() < period.start.getTime()) return period.days;
  return inclusiveDays(day, period.end);
}

// ---------------------------------------------------------------------------
// Proration
// ---------------------------------------------------------------------------

export interface ProratedAmount {
  amount: Decimal;
  daysCharged: number;
  daysInPeriod: number;
  explain: Explanation;
}

/** amount x daysCharged / daysInPeriod, rounded once. */
function prorate(
  fullAmount: Decimal,
  daysCharged: number,
  daysInPeriod: number,
  label: string,
  minorUnits = 2,
): ProratedAmount {
  const isPartial = daysCharged < daysInPeriod;
  const amount = isPartial
    ? money(fullAmount.times(daysCharged).dividedBy(daysInPeriod), minorUnits)
    : money(fullAmount, minorUnits);

  return {
    amount,
    daysCharged,
    daysInPeriod,
    explain: {
      label,
      value: amount.toFixed(minorUnits),
      inputs: {
        fullAmount: fullAmount.toFixed(minorUnits),
        daysCharged: String(daysCharged),
        daysInPeriod: String(daysInPeriod),
      },
      steps: [
        step(
          isPartial ? "Prorated" : "Full period",
          isPartial
            ? `${fullAmount.toFixed(minorUnits)} x ${daysCharged} / ${daysInPeriod}`
            : `${daysCharged} of ${daysInPeriod} days, so no proration`,
          amount.toFixed(minorUnits),
        ),
      ],
      sources: ["03_BUSINESS_RULES.md - Hybrid Billing Engine"],
    },
  };
}

/**
 * The first charge, when a subscription starts part-way through a period.
 *
 * A subscription starting on the first day of a period is not prorated at all.
 */
export function firstCycleCharge(params: {
  planAmount: DecimalValue;
  quantity?: number;
  startDate: Date;
  interval: BillingInterval;
  minorUnits?: number;
}): ProratedAmount {
  const period = periodContaining(params.startDate, params.interval);
  const full = new Decimal(params.planAmount).times(params.quantity ?? 1);
  const remaining = remainingDaysFrom(params.startDate, period);

  return prorate(full, remaining, period.days, "First cycle charge", params.minorUnits);
}

/**
 * A mid-cycle quantity change.
 *
 * The delta covers only the unused part of the current period, and is applied
 * to the *next* invoice rather than raised immediately - so a customer never
 * gets a surprise mid-month bill outside the normal cycle.
 *
 * A decrease produces a negative delta, which credits the next invoice.
 */
export function midCycleQuantityDelta(params: {
  unitPrice: DecimalValue;
  oldQuantity: number;
  newQuantity: number;
  changeDate: Date;
  interval: BillingInterval;
  minorUnits?: number;
}): ProratedAmount {
  const period = periodContaining(params.changeDate, params.interval);
  const remaining = remainingDaysFrom(params.changeDate, period);
  const quantityDelta = params.newQuantity - params.oldQuantity;
  const full = new Decimal(params.unitPrice).times(quantityDelta);

  const minorUnits = params.minorUnits ?? 2;
  const amount = money(full.times(remaining).dividedBy(period.days), minorUnits);

  return {
    amount,
    daysCharged: remaining,
    daysInPeriod: period.days,
    explain: {
      label: "Mid-cycle quantity change",
      value: amount.toFixed(minorUnits),
      inputs: {
        quantityChange: `${params.oldQuantity} to ${params.newQuantity}`,
        unitPrice: new Decimal(params.unitPrice).toFixed(minorUnits),
        remainingDays: String(remaining),
        daysInPeriod: String(period.days),
      },
      steps: [
        step(
          "Delta for the unused part of the period",
          `${quantityDelta} x ${new Decimal(params.unitPrice).toFixed(minorUnits)} x ${remaining} / ${period.days}`,
          amount.toFixed(minorUnits),
        ),
        step(
          "Applied to",
          "the next scheduled invoice, not raised immediately",
          "next cycle",
        ),
      ],
      sources: ["03_BUSINESS_RULES.md - Hybrid Billing Engine"],
    },
  };
}

/**
 * Credit owed on cancellation.
 *
 * Only the unused remainder of the current, already-paid period is credited.
 * Time already delivered is not refunded, so cancelling on the last day of a
 * period yields a credit for that day alone - never a negative amount.
 */
export function cancellationCredit(params: {
  planAmount: DecimalValue;
  quantity?: number;
  cancelDate: Date;
  interval: BillingInterval;
  minorUnits?: number;
}): ProratedAmount {
  const period = periodContaining(params.cancelDate, params.interval);
  const full = new Decimal(params.planAmount).times(params.quantity ?? 1);

  // Cancelling on the 20th of a 30-day month leaves 10 unused days: the 20th
  // itself is consumed, so the credit runs from the 21st to the 30th.
  const unused = Math.max(0, remainingDaysFrom(params.cancelDate, period) - 1);

  const minorUnits = params.minorUnits ?? 2;
  const amount = money(full.times(unused).dividedBy(period.days), minorUnits);

  return {
    amount,
    daysCharged: unused,
    daysInPeriod: period.days,
    explain: {
      label: "Cancellation credit",
      value: amount.toFixed(minorUnits),
      inputs: {
        planAmount: full.toFixed(minorUnits),
        unusedDays: String(unused),
        daysInPeriod: String(period.days),
      },
      steps: [
        step(
          "Unused days in the paid period",
          `${period.days} - ${period.days - unused} consumed`,
          String(unused),
        ),
        step(
          "Credit",
          `${full.toFixed(minorUnits)} x ${unused} / ${period.days}`,
          amount.toFixed(minorUnits),
        ),
      ],
      sources: ["03_BUSINESS_RULES.md - Hybrid Billing Engine"],
    },
  };
}

// ---------------------------------------------------------------------------
// Schedule construction
// ---------------------------------------------------------------------------

export interface ScheduleEntry {
  periodStart: Date;
  periodEnd: Date;
  /** Always the first day of the period: cycles are calendar-aligned. */
  billingDate: Date;
  amount: Decimal;
  /** Set only when the amount is not a whole period. */
  prorationNote: string | null;
}

/**
 * Materialise the schedule forward.
 *
 * Computed once and stored, rather than derived on every read. That makes the
 * billing screen a plain table, and turns a later change into an edit of future
 * rows instead of a re-derivation nobody can audit.
 */
export function buildSchedule(params: {
  planAmount: DecimalValue;
  quantity?: number;
  startDate: Date;
  interval: BillingInterval;
  periods: number;
  minorUnits?: number;
}): ScheduleEntry[] {
  const quantity = params.quantity ?? 1;
  const full = money(new Decimal(params.planAmount).times(quantity), params.minorUnits);

  const entries: ScheduleEntry[] = [];
  let period = periodContaining(params.startDate, params.interval);

  for (let i = 0; i < params.periods; i += 1) {
    const isFirst = i === 0;
    const remaining = isFirst ? remainingDaysFrom(params.startDate, period) : period.days;
    const partial = remaining < period.days;

    const amount = partial
      ? money(full.times(remaining).dividedBy(period.days), params.minorUnits)
      : full;

    entries.push({
      periodStart: isFirst && partial ? startOfDay(params.startDate) : period.start,
      periodEnd: period.end,
      billingDate: period.start,
      amount,
      prorationNote: partial
        ? `${remaining} of ${period.days} days, prorated from ${full.toFixed(2)}`
        : null,
    });

    period = nextPeriod(period, params.interval);
  }

  return entries;
}

function startOfDay(date: Date): Date {
  return utcMidnight(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}
