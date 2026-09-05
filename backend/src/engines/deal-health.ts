import { Prisma } from "../generated/prisma/client";
import type { DealSeverity } from "../generated/prisma/enums";
import { type Explanation, step } from "./explain";
import type { DecimalValue } from "./margin";

/**
 * The Deal Health engine, frozen in 03_BUSINESS_RULES.md.
 *
 *   health = 100 - (stalled + approvalDelay + negotiation + delivery + discountAnomaly)
 *
 *   stalled         min(30, days since last activity x 3)
 *   approvalDelay   min(20, days pending approval x 4)
 *   negotiation     min(15, completed rounds x 5)
 *   delivery        15 open backorder / 5 split / 0 single source
 *   discountAnomaly min(15, max(0, this quote average - the rep rolling average))
 *
 * Severity: 80-100 healthy, 60-79 watch, 35-59 at risk, 0-34 critical.
 *
 * ---------------------------------------------------------------------------
 * WHY THE RECOMMENDED ACTION IS NOT SIMPLY "THE BIGGEST PENALTY"
 * ---------------------------------------------------------------------------
 * In the worked example delivery scores 15 and approval delay 8, so the largest
 * penalty is delivery - yet the recommended action is to escalate the approval.
 * That is deliberate. A backorder is a logistics fact that nagging will not
 * change; an approval sitting on a person for two days is a human bottleneck,
 * and escalating it is what actually unsticks the deal.
 *
 * So the mapping prefers an actionable human blockage over a larger but inert
 * one. A dashboard that says "chase the warehouse" when the real problem is an
 * unread approval is worse than no dashboard.
 *
 * Pure: no database, no clock, no I/O.
 */

const Decimal = Prisma.Decimal;

export const HEALTH_WEIGHTS = {
  stalledPerDay: 3,
  stalledCap: 30,
  approvalDelayPerDay: 4,
  approvalDelayCap: 20,
  negotiationPerRound: 5,
  negotiationCap: 15,
  deliveryBackorder: 15,
  deliverySplit: 5,
  discountAnomalyCap: 15,
} as const;

/** 80-100 healthy, 60-79 watch, 35-59 at risk, 0-34 critical. */
export const SEVERITY_BANDS = { healthy: 80, watch: 60, atRisk: 35 } as const;

export const RECOMMENDED_ACTIONS = {
  escalate: "Escalate to Sales Manager",
  nudge: "Nudge rep or customer",
  monitor: "Monitor",
} as const;

export type DeliveryState = "NONE" | "SPLIT" | "BACKORDER";

export interface DealHealthInput {
  daysSinceLastActivity: number;
  /** Zero unless the quotation is actually waiting on a reviewer. */
  daysPendingApproval: number;
  negotiationRounds: number;
  delivery: DeliveryState;
  /** Mean line discount on this quotation. */
  averageDiscountOnQuote: DecimalValue;
  /** The rep's own rolling average, so the comparison is against their habit. */
  repRollingAverageDiscount: DecimalValue;
}

export interface HealthPenalties {
  stalled: number;
  approvalDelay: number;
  negotiation: number;
  delivery: number;
  discountAnomaly: number;
}

export interface DealHealthResult {
  healthScore: number;
  severity: DealSeverity;
  penalties: HealthPenalties;
  totalPenalty: number;
  recommendedAction: string;
  explain: Explanation;
}

function capped(value: number, cap: number): number {
  return Math.min(Math.max(0, Math.round(value)), cap);
}

export function severityFor(score: number): DealSeverity {
  if (score >= SEVERITY_BANDS.healthy) return "HEALTHY";
  if (score >= SEVERITY_BANDS.watch) return "WATCH";
  if (score >= SEVERITY_BANDS.atRisk) return "AT_RISK";
  return "CRITICAL";
}

export function computeDealHealth(input: DealHealthInput): DealHealthResult {
  const stalled = capped(
    input.daysSinceLastActivity * HEALTH_WEIGHTS.stalledPerDay,
    HEALTH_WEIGHTS.stalledCap,
  );
  const approvalDelay = capped(
    input.daysPendingApproval * HEALTH_WEIGHTS.approvalDelayPerDay,
    HEALTH_WEIGHTS.approvalDelayCap,
  );
  const negotiation = capped(
    input.negotiationRounds * HEALTH_WEIGHTS.negotiationPerRound,
    HEALTH_WEIGHTS.negotiationCap,
  );
  const delivery =
    input.delivery === "BACKORDER"
      ? HEALTH_WEIGHTS.deliveryBackorder
      : input.delivery === "SPLIT"
        ? HEALTH_WEIGHTS.deliverySplit
        : 0;

  // One point per percentage point this quote sits above the rep own average.
  const excess = new Decimal(input.averageDiscountOnQuote).minus(
    new Decimal(input.repRollingAverageDiscount),
  );
  const discountAnomaly = capped(
    excess.greaterThan(0) ? excess.toNumber() : 0,
    HEALTH_WEIGHTS.discountAnomalyCap,
  );

  const penalties: HealthPenalties = {
    stalled,
    approvalDelay,
    negotiation,
    delivery,
    discountAnomaly,
  };
  const totalPenalty = stalled + approvalDelay + negotiation + delivery + discountAnomaly;
  const healthScore = Math.max(0, 100 - totalPenalty);
  const severity = severityFor(healthScore);
  const recommendedAction = recommendActionFor(penalties, severity);

  return {
    healthScore,
    severity,
    penalties,
    totalPenalty,
    recommendedAction,
    explain: {
      label: "Deal health",
      value: `${healthScore} / 100`,
      inputs: {
        inactiveDays: String(input.daysSinceLastActivity),
        pendingApprovalDays: String(input.daysPendingApproval),
        negotiationRounds: String(input.negotiationRounds),
        delivery: input.delivery,
        quoteDiscount: new Decimal(input.averageDiscountOnQuote).toFixed(2),
        repAverageDiscount: new Decimal(input.repRollingAverageDiscount).toFixed(2),
      },
      steps: [
        step(
          "Stalled",
          `${input.daysSinceLastActivity} days x ${HEALTH_WEIGHTS.stalledPerDay}`,
          `-${stalled}`,
        ),
        step(
          "Approval delay",
          `${input.daysPendingApproval} days x ${HEALTH_WEIGHTS.approvalDelayPerDay}`,
          `-${approvalDelay}`,
        ),
        step(
          "Negotiation",
          `${input.negotiationRounds} rounds x ${HEALTH_WEIGHTS.negotiationPerRound}`,
          `-${negotiation}`,
        ),
        step("Delivery", input.delivery, `-${delivery}`),
        step(
          "Discount anomaly",
          `${new Decimal(input.averageDiscountOnQuote).toFixed(2)}% against a rep average of ${new Decimal(input.repRollingAverageDiscount).toFixed(2)}%`,
          `-${discountAnomaly}`,
        ),
        step("Health", `100 - ${totalPenalty}`, String(healthScore)),
        step("Recommended", reasonForAction(penalties, severity), recommendedAction),
      ],
      sources: ["03_BUSINESS_RULES.md - Deal Health Engine"],
    },
  };
}

/**
 * An unread approval outranks a larger logistics penalty.
 *
 * See the note at the top of the file: the point of the dashboard is to name
 * the thing a human can actually move.
 */
function recommendActionFor(penalties: HealthPenalties, severity: DealSeverity): string {
  const struggling = severity === "AT_RISK" || severity === "CRITICAL";

  if (struggling && penalties.approvalDelay > 0) return RECOMMENDED_ACTIONS.escalate;

  const others = [
    penalties.approvalDelay,
    penalties.negotiation,
    penalties.delivery,
    penalties.discountAnomaly,
  ];
  const stalledDominates =
    penalties.stalled > 0 && others.every((p) => penalties.stalled > p);
  if (stalledDominates) return RECOMMENDED_ACTIONS.nudge;

  return RECOMMENDED_ACTIONS.monitor;
}

function reasonForAction(penalties: HealthPenalties, severity: DealSeverity): string {
  const struggling = severity === "AT_RISK" || severity === "CRITICAL";
  if (struggling && penalties.approvalDelay > 0) {
    return "waiting on a reviewer, which is the blockage a person can clear";
  }
  const others = [
    penalties.approvalDelay,
    penalties.negotiation,
    penalties.delivery,
    penalties.discountAnomaly,
  ];
  if (penalties.stalled > 0 && others.every((p) => penalties.stalled > p)) {
    return "inactivity is the dominant penalty";
  }
  return "no single blockage dominates";
}
