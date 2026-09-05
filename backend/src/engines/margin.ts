import { Prisma } from "../generated/prisma/client";
import { type Explanation, step } from "./explain";

/**
 * The Margin Engine, frozen in 03_BUSINESS_RULES.md.
 *
 *   subtotal          = SUM(quantity x unitPrice)
 *   discountAmount    = SUM(quantity x unitPrice x discountPercentage / 100)
 *   netSellingValue   = subtotal - discountAmount
 *   estimatedCost     = SUM(quantity x unitCost)
 *   grossMargin       = netSellingValue - estimatedCost
 *   marginPercentage  = grossMargin / netSellingValue x 100
 *
 * Pure: no database, no clock, no I/O. It takes numbers and returns numbers, so
 * it is testable without a transaction and cannot drift from the documented
 * formula by quietly reading something else.
 *
 * Rounding precision is a *parameter*, not a constant, because it depends on the
 * currency — 2 places for INR and USD, 0 for JPY, 3 for KWD. Purity is why it
 * arrives as an argument rather than being looked up here: the caller resolves
 * it from settings and passes it in.
 *
 * Tax is deliberately absent. It is collected on behalf of the state, so it is
 * neither revenue nor margin — adding it here would inflate every margin in the
 * system.
 */

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/** Anything Decimal can be constructed from. Named separately because the
 *  `Decimal` type alias above shadows the namespace. */
export type DecimalValue = string | number | Prisma.Decimal;

/** Used when a caller does not supply precision. Matches INR, USD, EUR. */
export const DEFAULT_MINOR_UNITS = 2;
export const DEFAULT_PERCENT_DECIMALS = 2;

export interface Precision {
  /** Decimal places money rounds to. INR/USD 2, JPY 0, KWD 3. */
  minorUnits?: number;
  /** Decimal places percentages round to. */
  percentDecimals?: number;
}

interface ResolvedPrecision {
  minorUnits: number;
  percentDecimals: number;
}

function resolve(p?: Precision): ResolvedPrecision {
  return {
    minorUnits: p?.minorUnits ?? DEFAULT_MINOR_UNITS,
    percentDecimals: p?.percentDecimals ?? DEFAULT_PERCENT_DECIMALS,
  };
}

/** D2 — half-up, applied at boundaries only, never mid-computation. */
function money(value: Decimal, dp: number): Decimal {
  return value.toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
}

function percent(value: Decimal, dp: number): Decimal {
  return value.toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
}

export interface MarginLineInput {
  /** Carried through so a caller can match results back to rows. */
  lineId?: string;
  label?: string;
  quantity: number;
  unitPrice: DecimalValue;
  /** 0..100. */
  discountPercentage: DecimalValue;
  unitCost: DecimalValue;
}

export interface MarginResult {
  subtotal: Decimal;
  discountAmount: Decimal;
  netSellingValue: Decimal;
  estimatedCost: Decimal;
  grossMargin: Decimal;
  marginPercentage: Decimal;
}

export interface LineMarginResult extends MarginResult {
  lineId?: string;
  label?: string;
}

export interface OrderMarginResult extends MarginResult {
  lines: LineMarginResult[];
  explain: Explanation;
}

/** One line's contribution. Rounded at the line boundary, per D2. */
export function computeLineMargin(
  line: MarginLineInput,
  precision?: Precision,
): LineMarginResult {
  const { minorUnits, percentDecimals } = resolve(precision);

  const quantity = new Decimal(line.quantity);
  const unitPrice = new Decimal(line.unitPrice);
  const discountPercentage = new Decimal(line.discountPercentage);
  const unitCost = new Decimal(line.unitCost);

  const subtotal = money(quantity.times(unitPrice), minorUnits);
  const discountAmount = money(
    subtotal.times(discountPercentage).dividedBy(100),
    minorUnits,
  );
  const netSellingValue = money(subtotal.minus(discountAmount), minorUnits);
  const estimatedCost = money(quantity.times(unitCost), minorUnits);
  const grossMargin = money(netSellingValue.minus(estimatedCost), minorUnits);

  return {
    lineId: line.lineId,
    label: line.label,
    subtotal,
    discountAmount,
    netSellingValue,
    estimatedCost,
    grossMargin,
    marginPercentage: marginPercentageOf(grossMargin, netSellingValue, percentDecimals),
  };
}

/**
 * Margin percentage, guarded against division by zero.
 *
 * A net selling value of zero is defined as 0% rather than raising: a fully
 * discounted line is a legitimate (if alarming) thing for a rep to type, and
 * the risk engine's margin-exposure contributor still reads the result. It is
 * the risk score's job to flag it, not the margin engine's job to refuse it.
 */
export function marginPercentageOf(
  grossMargin: Decimal,
  netSellingValue: Decimal,
  percentDecimals: number = DEFAULT_PERCENT_DECIMALS,
): Decimal {
  if (netSellingValue.isZero()) return new Decimal(0);
  return percent(grossMargin.dividedBy(netSellingValue).times(100), percentDecimals);
}

/** Whole-order margin, plus its own derivation. */
export function computeOrderMargin(
  lines: MarginLineInput[],
  precision?: Precision,
): OrderMarginResult {
  const { minorUnits, percentDecimals } = resolve(precision);
  const computed = lines.map((l) => computeLineMargin(l, precision));

  const zero = new Decimal(0);
  const sum = (pick: (l: LineMarginResult) => Decimal) =>
    money(computed.reduce((acc, l) => acc.plus(pick(l)), zero), minorUnits);

  const subtotal = sum((l) => l.subtotal);
  const discountAmount = sum((l) => l.discountAmount);
  const netSellingValue = money(subtotal.minus(discountAmount), minorUnits);
  const estimatedCost = sum((l) => l.estimatedCost);
  const grossMargin = money(netSellingValue.minus(estimatedCost), minorUnits);
  const marginPercentage = marginPercentageOf(grossMargin, netSellingValue, percentDecimals);

  const fx = (d: Decimal) => d.toFixed(minorUnits);

  return {
    subtotal,
    discountAmount,
    netSellingValue,
    estimatedCost,
    grossMargin,
    marginPercentage,
    lines: computed,
    explain: {
      label: "Gross margin",
      value: fx(grossMargin),
      inputs: Object.fromEntries(
        computed.map((l, i) => [
          l.label ?? l.lineId ?? `line ${i + 1}`,
          `${lines[i].quantity} x ${fx(new Decimal(lines[i].unitPrice))} ` +
            `less ${new Decimal(lines[i].discountPercentage).toFixed(percentDecimals)}%, ` +
            `cost ${fx(new Decimal(lines[i].unitCost))}`,
        ]),
      ),
      steps: [
        step(
          "Subtotal",
          computed.map((l) => fx(l.subtotal)).join(" + ") || fx(zero),
          fx(subtotal),
        ),
        step(
          "Discount",
          computed.map((l) => fx(l.discountAmount)).join(" + ") || fx(zero),
          fx(discountAmount),
        ),
        step(
          "Net selling value",
          `${fx(subtotal)} - ${fx(discountAmount)}`,
          fx(netSellingValue),
        ),
        step(
          "Estimated cost",
          computed.map((l) => fx(l.estimatedCost)).join(" + ") || fx(zero),
          fx(estimatedCost),
        ),
        step(
          "Gross margin",
          `${fx(netSellingValue)} - ${fx(estimatedCost)}`,
          fx(grossMargin),
        ),
        step(
          "Margin percentage",
          netSellingValue.isZero()
            ? "net selling value is 0, defined as 0%"
            : `${fx(grossMargin)} / ${fx(netSellingValue)} x 100`,
          `${marginPercentage.toFixed(percentDecimals)}%`,
        ),
      ],
      sources: ["03_BUSINESS_RULES.md - Margin Engine"],
    },
  };
}
