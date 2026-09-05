import { Prisma } from "../generated/prisma/client";
import type { RiskFactorSource, RiskLevel } from "../generated/prisma/enums";
import { type Explanation, step } from "./explain";
import type { DecimalValue } from "./margin";

/**
 * The Blended Discount Risk Engine, frozen in 03_BUSINESS_RULES.md.
 *
 * Five independent contributors, so the reason for a score is always a list
 * rather than a black box:
 *
 *   category violation    worst single line's excess over its ceiling x 2.5, cap 30
 *   deviation breadth     each *additional* violating line x 4,               cap 15
 *   margin exposure       shortfall against the target margin x 1.2,          cap 30
 *   repeated negotiation  completed negotiation rounds x 5,                   cap 15
 *   delivery risk         0 single source / 5 split / 10 any backorder
 *
 * Pure: no database, no clock, no I/O. Ceilings arrive already resolved, which
 * keeps the D10 lookup (category -> tier -> fallback) in the service layer where
 * it belongs and leaves the scoring testable without a transaction.
 *
 * Why the caps are code and not configuration: §A3 asks for a configurable
 * *approval chain* — which score range needs which approver — and that is the
 * ApprovalChain table (D11). The weights themselves are the frozen formula the
 * worked example pins. Making them editable would let a demo silently retune
 * itself until the documented 44/100 no longer reproduced.
 */

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/**
 * D7 — margin exposure caps at 30, not the 25 originally written.
 *
 * Two reasons. The caps now sum to exactly 100, so the score can reach the top
 * of its own range. More importantly, under the old cap an order with every
 * line inside its ceiling but a wrecked blended margin topped out at 25 — below
 * the approval threshold — so it never routed for review. That is precisely the
 * failure page 12 of the problem statement describes: "It stops a rep from
 * keeping every line technically within limits while still discounting the
 * order more than the company intends overall."
 */
export const RISK_WEIGHTS = {
  categoryViolationPerPoint: "2.5",
  categoryViolationCap: 30,
  deviationBreadthPerLine: 4,
  deviationBreadthCap: 15,
  marginExposurePerPoint: "1.2",
  marginExposureCap: 30,
  negotiationPerRound: 5,
  negotiationCap: 15,
  deliverySplit: 5,
  deliveryBackorder: 10,
} as const;

/** 0-29 low, 30-59 medium, 60-100 high. */
export const RISK_BANDS = { medium: 30, high: 60 } as const;

export const MAX_RISK_SCORE =
  RISK_WEIGHTS.categoryViolationCap +
  RISK_WEIGHTS.deviationBreadthCap +
  RISK_WEIGHTS.marginExposureCap +
  RISK_WEIGHTS.negotiationCap +
  RISK_WEIGHTS.deliveryBackorder;

export type DeliveryRisk = "NONE" | "SPLIT" | "BACKORDER";

export interface RiskLineInput {
  lineId?: string;
  label?: string;
  discountPercentage: DecimalValue;
  /** Already resolved by the service: category policy -> tier -> fallback. */
  discountCeiling: DecimalValue;
}

export interface RiskInput {
  lines: RiskLineInput[];
  marginPercentage: DecimalValue;
  targetMarginPercentage: DecimalValue;
  /** Completed rounds, not the round in progress. */
  negotiationCount: number;
  /**
   * Advisory only, from the pre-flight fulfilment plan (D4). It reserves
   * nothing, so this can go stale between scoring and allocation — D15 records
   * that variance rather than re-triggering approval.
   */
  deliveryRisk?: DeliveryRisk;
}

export interface RiskFactorResult {
  source: RiskFactorSource;
  points: number;
  description: string;
  /** The arithmetic, so a screen shows "8.0 over x 2.5 = 20", not "+20". */
  formula: string;
  sequence: number;
}

export interface RiskResult {
  score: number;
  level: RiskLevel;
  factors: RiskFactorResult[];
  /** The independent half of the approval trigger. */
  anyLineOverCeiling: boolean;
  worstExcess: Decimal;
  violatingLineCount: number;
  maxLineDiscount: Decimal;
  explain: Explanation;
}

/** Contributors are whole numbers; 9.6 points of margin exposure shows as 10. */
function points(value: Decimal, cap: number): number {
  const rounded = value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  return Math.min(rounded, cap);
}

export function riskLevelFor(score: number): RiskLevel {
  if (score >= RISK_BANDS.high) return "HIGH";
  if (score >= RISK_BANDS.medium) return "MEDIUM";
  return "LOW";
}

export function computeRisk(input: RiskInput): RiskResult {
  const zero = new Decimal(0);

  // --- Per-line excess over ceiling ---------------------------------------
  // Strictly greater-than: a line *at* its ceiling is compliant. 10.00% against
  // a 10% ceiling is fine; 10.01% is not.
  const excesses = input.lines.map((line) => {
    const discount = new Decimal(line.discountPercentage);
    const ceiling = new Decimal(line.discountCeiling);
    const excess = discount.greaterThan(ceiling) ? discount.minus(ceiling) : zero;
    return { line, discount, ceiling, excess };
  });

  const violating = excesses.filter((e) => e.excess.greaterThan(0));
  const anyLineOverCeiling = violating.length > 0;
  const violatingLineCount = violating.length;

  // Ties break on line order, so a score is reproducible.
  const worst = violating.reduce<(typeof excesses)[number] | null>(
    (acc, e) => (acc === null || e.excess.greaterThan(acc.excess) ? e : acc),
    null,
  );
  const worstExcess = worst?.excess ?? zero;

  const maxLineDiscount = excesses.reduce(
    (acc, e) => (e.discount.greaterThan(acc) ? e.discount : acc),
    zero,
  );

  const factors: RiskFactorResult[] = [];

  // 1. Category violation — the single worst line only. Breadth is counted
  //    separately below, so the two never double-count the same line.
  const categoryPoints = points(
    worstExcess.times(RISK_WEIGHTS.categoryViolationPerPoint),
    RISK_WEIGHTS.categoryViolationCap,
  );
  factors.push({
    source: "CATEGORY_VIOLATION",
    points: categoryPoints,
    description: worst
      ? `${worst.line.label ?? "Line"} is ${worstExcess.toFixed(1)} points over its ${worst.ceiling.toFixed(0)}% ceiling`
      : "No line exceeds its category ceiling",
    formula: `${worstExcess.toFixed(1)} over x ${RISK_WEIGHTS.categoryViolationPerPoint} = ${categoryPoints}`,
    sequence: 1,
  });

  // 2. Deviation breadth — the "blended" part. Several lines each slightly over
  //    is the pattern the spec says must not slip through unnoticed.
  const extraViolating = Math.max(0, violatingLineCount - 1);
  const breadthPoints = points(
    new Decimal(extraViolating).times(RISK_WEIGHTS.deviationBreadthPerLine),
    RISK_WEIGHTS.deviationBreadthCap,
  );
  factors.push({
    source: "DEVIATION_BREADTH",
    points: breadthPoints,
    description:
      extraViolating > 0
        ? `${extraViolating} further line${extraViolating === 1 ? "" : "s"} also over ceiling`
        : "No additional lines over ceiling",
    formula: `${extraViolating} x ${RISK_WEIGHTS.deviationBreadthPerLine} = ${breadthPoints}`,
    sequence: 2,
  });

  // 3. Margin exposure — shortfall against the configured target.
  const actualMargin = new Decimal(input.marginPercentage);
  const targetMargin = new Decimal(input.targetMarginPercentage);
  const marginGap = targetMargin.greaterThan(actualMargin)
    ? targetMargin.minus(actualMargin)
    : zero;
  const marginPoints = points(
    marginGap.times(RISK_WEIGHTS.marginExposurePerPoint),
    RISK_WEIGHTS.marginExposureCap,
  );
  factors.push({
    source: "MARGIN_EXPOSURE",
    points: marginPoints,
    description: marginGap.greaterThan(0)
      ? `Order margin ${actualMargin.toFixed(1)}% is ${marginGap.toFixed(1)} points below the ${targetMargin.toFixed(0)}% target`
      : `Order margin ${actualMargin.toFixed(1)}% meets the ${targetMargin.toFixed(0)}% target`,
    formula: `${marginGap.toFixed(1)} gap x ${RISK_WEIGHTS.marginExposurePerPoint} = ${marginPoints}`,
    sequence: 3,
  });

  // 4. Repeated negotiation.
  const negotiationPoints = points(
    new Decimal(input.negotiationCount).times(RISK_WEIGHTS.negotiationPerRound),
    RISK_WEIGHTS.negotiationCap,
  );
  factors.push({
    source: "REPEATED_NEGOTIATION",
    points: negotiationPoints,
    description:
      input.negotiationCount > 0
        ? `${input.negotiationCount} completed negotiation round${input.negotiationCount === 1 ? "" : "s"}`
        : "No prior negotiation",
    formula: `${input.negotiationCount} x ${RISK_WEIGHTS.negotiationPerRound} = ${negotiationPoints}`,
    sequence: 4,
  });

  // 5. Delivery risk.
  const delivery = input.deliveryRisk ?? "NONE";
  const deliveryPoints =
    delivery === "BACKORDER"
      ? RISK_WEIGHTS.deliveryBackorder
      : delivery === "SPLIT"
        ? RISK_WEIGHTS.deliverySplit
        : 0;
  factors.push({
    source: "DELIVERY_RISK",
    points: deliveryPoints,
    description:
      delivery === "BACKORDER"
        ? "Part of the order cannot be fulfilled and becomes a backorder"
        : delivery === "SPLIT"
          ? "Fulfilment requires a split across more than one warehouse"
          : "Fulfils from a single warehouse with no backorder",
    formula: `${delivery} = ${deliveryPoints}`,
    sequence: 5,
  });

  const score = Math.min(
    factors.reduce((acc, f) => acc + f.points, 0),
    MAX_RISK_SCORE,
  );
  const level = riskLevelFor(score);

  return {
    score,
    level,
    factors,
    anyLineOverCeiling,
    worstExcess,
    violatingLineCount,
    maxLineDiscount,
    explain: {
      label: "Blended discount risk",
      value: `${score} / ${MAX_RISK_SCORE}`,
      inputs: {
        lines: `${input.lines.length} line${input.lines.length === 1 ? "" : "s"}, ${violatingLineCount} over ceiling`,
        margin: `${actualMargin.toFixed(1)}% against a ${targetMargin.toFixed(0)}% target`,
        negotiation: `${input.negotiationCount} completed round${input.negotiationCount === 1 ? "" : "s"}`,
        delivery,
      },
      steps: factors.map((f) => step(f.description, f.formula, `+${f.points}`)),
      sources: ["03_BUSINESS_RULES.md - Blended Discount Risk Engine", "D7"],
    },
  };
}
