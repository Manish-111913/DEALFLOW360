import { Prisma } from "../generated/prisma/client";
import { type Explanation, step } from "./explain";
import type { DecimalValue } from "./margin";

/**
 * The Upsell / Cross-Sell ranking engine, frozen in 03_BUSINESS_RULES.md.
 *
 *   normalised margin = min(1, suggested margin % / 50)
 *   score = (co-purchase rate x 0.6) + (normalised margin x 0.3) + (0.1 if promoted)
 *
 * A candidate is filtered out entirely if the suggested product's margin falls
 * below the pairing's own floor — a promoted product with a bad margin is never
 * shown, on principle. Filtering happens before ranking, so a high co-purchase
 * rate can never drag an unprofitable suggestion into the list.
 *
 * Pure: no database, no clock, no I/O. Effective co-purchase rates arrive
 * already resolved, which keeps the derivation (D14 — computed from real order
 * history) in the service layer where the SQL belongs.
 *
 * There is deliberately no generic fallback. If nothing pairs, the answer is an
 * empty list, not a filler suggestion: §7 requires recommendations to be
 * grounded, and an ungrounded suggestion breaks that more than showing none.
 */

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export const UPSELL_WEIGHTS = {
  coPurchase: "0.6",
  margin: "0.3",
  promotionBoost: "0.1",
  /** A margin of 50% or better earns the full weight; below that it scales. */
  marginNormalisationCeiling: "50",
} as const;

/** §B5 shows a ranked list beside the cart; three is what fits and what the rules freeze. */
export const MAX_SUGGESTIONS = 3;

export interface UpsellCandidateInput {
  productId: string;
  productName: string;
  /** 0..1, already resolved: derived from history unless an admin overrode it. */
  coPurchaseRate: DecimalValue;
  /** The pairing's floor. Below this the candidate never surfaces. */
  minMarginPercentage: DecimalValue;
  isPromoted: boolean;
  unitPrice: DecimalValue;
  unitCost: DecimalValue;
  suggestedQuantity?: number;
  /** Which cart line triggered this, for the reason shown to a rep. */
  triggeredByProductName?: string;
}

export interface UpsellSuggestion {
  productId: string;
  productName: string;
  score: Decimal;
  /** Human-readable grounding, e.g. "72% of similar orders include this". */
  reason: string;
  marginImpact: Decimal;
  marginPercentage: Decimal;
  isPromoted: boolean;
  suggestedQuantity: number;
  triggeredByProductName?: string;
  explain: Explanation;
}

function marginPercentageOf(unitPrice: Decimal, unitCost: Decimal): Decimal {
  if (unitPrice.isZero()) return new Decimal(0);
  return unitPrice.minus(unitCost).dividedBy(unitPrice).times(100);
}

/**
 * Rank candidates, filtering below-floor margins first.
 *
 * Ties break on co-purchase rate then name, so the same cart always produces
 * the same list — a suggestion panel that reshuffles on refresh reads as random
 * even when it is not.
 */
/**
 * The parts of the score a company can turn off.
 *
 * Each of these is a real input to the ranking, not a label: with `useHistory`
 * off the co-purchase term drops out and only configured rates and margin
 * decide the order; with `usePromoted` off a promoted product loses its bonus
 * and has to earn its place; `minMarginPercentage` is a floor applied on top of
 * each pairing's own, so raising it removes suggestions rather than reordering
 * them. Every field is optional and defaults to today's behaviour.
 */
export interface UpsellPolicy {
  useHistory?: boolean;
  usePromoted?: boolean;
  minMarginPercentage?: DecimalValue;
}

export function rankUpsells(
  candidates: UpsellCandidateInput[],
  options?: { limit?: number; policy?: UpsellPolicy },
): UpsellSuggestion[] {
  const limit = options?.limit ?? MAX_SUGGESTIONS;
  const useHistory = options?.policy?.useHistory ?? true;
  const usePromoted = options?.policy?.usePromoted ?? true;
  const companyFloor = new Decimal(options?.policy?.minMarginPercentage ?? 0);
  const wCoPurchase = new Decimal(UPSELL_WEIGHTS.coPurchase);
  const wMargin = new Decimal(UPSELL_WEIGHTS.margin);
  const boost = new Decimal(UPSELL_WEIGHTS.promotionBoost);
  const ceiling = new Decimal(UPSELL_WEIGHTS.marginNormalisationCeiling);

  const scored = candidates
    .map((c) => {
      const unitPrice = new Decimal(c.unitPrice);
      const unitCost = new Decimal(c.unitCost);
      const quantity = c.suggestedQuantity ?? 1;
      // With history off the co-purchase term contributes nothing, so ranking
      // falls to margin and promotion alone.
      const rate = useHistory ? new Decimal(c.coPurchaseRate) : new Decimal(0);
      // Whichever floor is higher wins: a company-wide minimum can only tighten
      // a pairing's own, never loosen it.
      const floor = Decimal.max(new Decimal(c.minMarginPercentage), companyFloor);
      const marginPercentage = marginPercentageOf(unitPrice, unitCost);

      return { c, unitPrice, unitCost, quantity, rate, floor, marginPercentage };
    })
    // The floor is absolute: no co-purchase rate and no promotion rescues a
    // suggestion that would damage margin.
    .filter((x) => !x.marginPercentage.lessThan(x.floor))
    .map((x) => {
      const normalisedMargin = Decimal.min(new Decimal(1), x.marginPercentage.dividedBy(ceiling));
      const promotionPoints = x.c.isPromoted && usePromoted ? boost : new Decimal(0);
      const score = x.rate
        .times(wCoPurchase)
        .plus(normalisedMargin.times(wMargin))
        .plus(promotionPoints);

      // Margin impact is the margin the line would actually add. This is
      // quantity x unitPrice x marginPercentage evaluated without rounding the
      // percentage first, which is why it lands on a clean figure rather than
      // five paise short of one.
      const marginImpact = x.unitPrice.minus(x.unitCost).times(x.quantity);

      const percentLabel = x.rate.times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
      const reason = `${percentLabel.toFixed(0)}% of similar orders include this`;

      const suggestion: UpsellSuggestion = {
        productId: x.c.productId,
        productName: x.c.productName,
        score,
        reason,
        marginImpact,
        marginPercentage: x.marginPercentage.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
        isPromoted: x.c.isPromoted,
        suggestedQuantity: x.quantity,
        triggeredByProductName: x.c.triggeredByProductName,
        explain: {
          label: `Why ${x.c.productName}`,
          value: score.toFixed(4),
          inputs: {
            coPurchaseRate: x.rate.toFixed(4),
            marginPercentage: `${x.marginPercentage.toFixed(2)}%`,
            marginFloor: `${x.floor.toFixed(2)}%`,
            promoted: String(x.c.isPromoted),
          },
          steps: [
            step(
              "Co-purchase weight",
              `${x.rate.toFixed(4)} x ${UPSELL_WEIGHTS.coPurchase}`,
              x.rate.times(wCoPurchase).toFixed(4),
            ),
            step(
              "Normalised margin",
              `min(1, ${x.marginPercentage.toFixed(2)} / ${UPSELL_WEIGHTS.marginNormalisationCeiling}) x ${UPSELL_WEIGHTS.margin}`,
              normalisedMargin.times(wMargin).toFixed(4),
            ),
            step(
              "Promotion boost",
              x.c.isPromoted ? `promoted, +${UPSELL_WEIGHTS.promotionBoost}` : "not promoted",
              promotionPoints.toFixed(4),
            ),
            step("Score", "sum of the above", score.toFixed(4)),
            step(
              "Margin impact",
              `${x.quantity} x (${x.unitPrice.toFixed(2)} - ${x.unitCost.toFixed(2)})`,
              marginImpact.toFixed(2),
            ),
          ],
          sources: ["03_BUSINESS_RULES.md - Upsell / Cross-Sell Engine", "D14"],
        },
      };
      return suggestion;
    });

  scored.sort((a, b) => {
    const byScore = b.score.comparedTo(a.score);
    if (byScore !== 0) return byScore;
    const byMargin = b.marginImpact.comparedTo(a.marginImpact);
    if (byMargin !== 0) return byMargin;
    return a.productName.localeCompare(b.productName);
  });

  return scored.slice(0, limit);
}
