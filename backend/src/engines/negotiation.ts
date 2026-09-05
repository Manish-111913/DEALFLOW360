import { Prisma } from "../generated/prisma/client";
import type { Role } from "../generated/prisma/enums";
import { type Explanation, step } from "./explain";
import type { DecimalValue } from "./margin";

/**
 * The Customer Negotiation what-if, frozen in 03_BUSINESS_RULES.md.
 *
 * ---------------------------------------------------------------------------
 * WHY IT COMPARES AGAINST THE APPROVED SNAPSHOT, NOT THE LIVE QUOTE
 * ---------------------------------------------------------------------------
 * A quotation drifts. Lines get edited, discounts nudged, upsells accepted. If
 * a customer request were evaluated against the current live state, a quote
 * that had already drifted past what a manager signed off would compare a
 * moving target against itself and quietly conclude that nothing had changed.
 *
 * So the question is always: does this proposal go beyond what a human actually
 * approved? That is what `approvedLines` carries.
 *
 * ---------------------------------------------------------------------------
 * THE TRIGGER
 * ---------------------------------------------------------------------------
 * Re-approval is required when either:
 *
 *   a) any line asks for a deeper discount than the one approved for it, or
 *   b) the proposal pulls in an approver the approved version did not need
 *
 * (a) alone settles the documented case - approved at 10%, customer asks 15%.
 * The score may stay in the same band; it does not matter, because a line
 * moving further past its ceiling is enough on its own.
 *
 * (b) catches the subtler case: a quantity change that leaves every discount
 * untouched but drags the blended margin down far enough to need Finance.
 *
 * Pure: no database, no clock, no I/O.
 */

const Decimal = Prisma.Decimal;

export interface LineTerms {
  lineId: string;
  label?: string;
  discountPercentage: DecimalValue;
  discountCeiling: DecimalValue;
}

export interface WhatIfInput {
  /** Terms as they stood when a human approved them. */
  approvedLines: LineTerms[];
  /** Terms as they would stand if the request were accepted. */
  proposedLines: LineTerms[];
  approvedScore: number;
  proposedScore: number;
  /** Approvers the approved version needed, in order. */
  approvedApprovers: Role[];
  /** Approvers the proposed version would need. */
  proposedApprovers: Role[];
}

export interface WorsenedLine {
  lineId: string;
  label?: string;
  approvedDiscount: string;
  proposedDiscount: string;
  /** Points past the ceiling before and after, for the reviewer's diff. */
  approvedExcess: string;
  proposedExcess: string;
}

export interface WhatIfResult {
  requiresReapproval: boolean;
  reason: string;
  worsenedLines: WorsenedLine[];
  newApprovers: Role[];
  scoreDelta: number;
  explain: Explanation;
}

function excessOver(discount: Prisma.Decimal, ceiling: Prisma.Decimal): Prisma.Decimal {
  return discount.greaterThan(ceiling) ? discount.minus(ceiling) : new Decimal(0);
}

export function evaluateWhatIf(input: WhatIfInput): WhatIfResult {
  const approvedByLine = new Map(input.approvedLines.map((l) => [l.lineId, l]));

  // (a) Any line asking for more than was approved for it.
  const worsenedLines: WorsenedLine[] = [];
  for (const proposed of input.proposedLines) {
    const approved = approvedByLine.get(proposed.lineId);
    const proposedDiscount = new Decimal(proposed.discountPercentage);
    const ceiling = new Decimal(proposed.discountCeiling);

    // A line that did not exist at approval time is new commercial content, so
    // it is treated as an increase from zero.
    const approvedDiscount = approved
      ? new Decimal(approved.discountPercentage)
      : new Decimal(0);

    if (proposedDiscount.lessThanOrEqualTo(approvedDiscount)) continue;

    worsenedLines.push({
      lineId: proposed.lineId,
      label: proposed.label,
      approvedDiscount: approvedDiscount.toFixed(2),
      proposedDiscount: proposedDiscount.toFixed(2),
      approvedExcess: excessOver(
        approvedDiscount,
        approved ? new Decimal(approved.discountCeiling) : ceiling,
      ).toFixed(2),
      proposedExcess: excessOver(proposedDiscount, ceiling).toFixed(2),
    });
  }

  // (b) Any approver the approved version did not already involve.
  const approvedSet = new Set(input.approvedApprovers);
  const newApprovers = input.proposedApprovers.filter((r) => !approvedSet.has(r));

  const requiresReapproval = worsenedLines.length > 0 || newApprovers.length > 0;
  const scoreDelta = input.proposedScore - input.approvedScore;

  const reason = !requiresReapproval
    ? "The proposal stays within terms already approved"
    : worsenedLines.length > 0
      ? `${worsenedLines.length} line${worsenedLines.length === 1 ? "" : "s"} would be discounted beyond what was approved`
      : `The proposal would newly require ${newApprovers.join(" and ")}`;

  return {
    requiresReapproval,
    reason,
    worsenedLines,
    newApprovers,
    scoreDelta,
    explain: {
      label: "Negotiation what-if",
      value: requiresReapproval ? "Re-approval required" : "Within approved terms",
      inputs: {
        approvedScore: String(input.approvedScore),
        proposedScore: String(input.proposedScore),
        approvedApprovers: input.approvedApprovers.join(", ") || "none",
      },
      steps: [
        step(
          "Lines beyond approved terms",
          worsenedLines.length > 0
            ? worsenedLines
                .map((l) => `${l.label ?? l.lineId}: ${l.approvedDiscount}% to ${l.proposedDiscount}%`)
                .join("; ")
            : "none",
          String(worsenedLines.length),
        ),
        step(
          "Approvers newly required",
          newApprovers.length > 0 ? newApprovers.join(", ") : "none",
          String(newApprovers.length),
        ),
        step(
          "Risk score movement",
          `${input.approvedScore} to ${input.proposedScore}`,
          `${scoreDelta >= 0 ? "+" : ""}${scoreDelta}`,
        ),
        step("Outcome", reason, requiresReapproval ? "re-approve" : "apply immediately"),
      ],
      sources: ["03_BUSINESS_RULES.md - Customer Negotiation Engine", "D5"],
    },
  };
}
