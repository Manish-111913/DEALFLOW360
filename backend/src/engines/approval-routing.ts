import { Prisma } from "../generated/prisma/client";
import type { Role } from "../generated/prisma/enums";
import { type Explanation, step } from "./explain";

/**
 * Which approvers a quotation needs.
 *
 * D11 — §A3 asks for a configurable approval chain ("which discount range needs
 * Sales Manager only, and which range needs Sales Manager followed by
 * Finance"), so the ranges live in the ApprovalStep table rather than in an
 * `if`. Seeded to reproduce the documented 30/60 behaviour, so the frozen
 * worked examples still hold.
 *
 * The trigger has two independent halves, and that is deliberate:
 *
 *   approval required = (any line over its ceiling) OR (score in a step's range)
 *
 * A single clearly-over-ceiling line must reach a human even when the rest of
 * the arithmetic keeps the total small. Conversely a quote with every line
 * inside its ceiling can still need review if the blended score says so. Either
 * half alone would miss cases the other catches.
 */

type Decimal = Prisma.Decimal;

export interface ApprovalStepConfig {
  id: string;
  stepOrder: number;
  approverRole: Role;
  minRiskScore: Decimal | null;
  maxRiskScore: Decimal | null;
  minDiscount: Decimal | null;
  maxDiscount: Decimal | null;
}

export interface RoutingInput {
  steps: ApprovalStepConfig[];
  score: number;
  anyLineOverCeiling: boolean;
  /** The largest discount on any single line, for discount-banded steps. */
  maxLineDiscount: Decimal;
}

export interface RoutingResult {
  required: boolean;
  /** In order. Empty when no approval is needed. */
  steps: ApprovalStepConfig[];
  reason: string;
  explain: Explanation;
}

function withinScore(config: ApprovalStepConfig, score: number): boolean {
  if (config.minRiskScore !== null && score < config.minRiskScore.toNumber()) return false;
  if (config.maxRiskScore !== null && score > config.maxRiskScore.toNumber()) return false;
  return true;
}

function withinDiscount(config: ApprovalStepConfig, discount: Decimal): boolean {
  if (config.minDiscount !== null && discount.lessThan(config.minDiscount)) return false;
  if (config.maxDiscount !== null && discount.greaterThan(config.maxDiscount)) return false;
  return true;
}

/** A step with no bounds at all would match everything; treat it as a default. */
function isUnbounded(config: ApprovalStepConfig): boolean {
  return (
    config.minRiskScore === null &&
    config.maxRiskScore === null &&
    config.minDiscount === null &&
    config.maxDiscount === null
  );
}

export function resolveApprovalRoute(input: RoutingInput): RoutingResult {
  const ordered = [...input.steps].sort((a, b) => a.stepOrder - b.stepOrder);

  const matching = ordered.filter(
    (s) =>
      !isUnbounded(s) &&
      withinScore(s, input.score) &&
      withinDiscount(s, input.maxLineDiscount),
  );

  const required = input.anyLineOverCeiling || matching.length > 0;

  // A ceiling breach that scores below every configured band still needs a
  // human. Falling back to the first step is what stops "technically compliant
  // arithmetic" from routing a genuine violation straight through.
  let steps = matching;
  if (required && steps.length === 0 && ordered.length > 0) {
    steps = [ordered[0]];
  }

  const reason = !required
    ? "No line exceeds its ceiling and the score is below every approval band"
    : input.anyLineOverCeiling && matching.length === 0
      ? "A line exceeds its category ceiling"
      : input.anyLineOverCeiling
        ? `A line exceeds its category ceiling, and the score of ${input.score} reaches an approval band`
        : `Risk score ${input.score} reaches an approval band`;

  return {
    required,
    steps,
    reason,
    explain: {
      label: "Approval routing",
      value: required ? steps.map((s) => s.approverRole).join(" then ") : "Not required",
      inputs: {
        score: String(input.score),
        anyLineOverCeiling: String(input.anyLineOverCeiling),
        maxLineDiscount: `${input.maxLineDiscount.toFixed(2)}%`,
        configuredSteps: String(ordered.length),
      },
      steps: [
        step(
          "Ceiling breach",
          input.anyLineOverCeiling ? "at least one line over its ceiling" : "no line over ceiling",
          String(input.anyLineOverCeiling),
        ),
        step(
          "Score bands matched",
          matching.map((s) => `${s.approverRole}(order ${s.stepOrder})`).join(", ") || "none",
          String(matching.length),
        ),
        step("Approval required", reason, String(required)),
      ],
      sources: ["03_BUSINESS_RULES.md - Approval trigger", "D11"],
    },
  };
}
