import { Prisma } from "../generated/prisma/client";
import type { CustomerTier } from "../generated/prisma/enums";
import { assertCan, type AuthzUser } from "../authz/roles";
import { prisma } from "../db";
import { resolveApprovalRoute } from "../engines/approval-routing";
import { NotFoundError, ValidationError } from "../errors";
import { loadActiveApprovalSteps } from "./approvals";
import { resolveCeilings } from "./discount-policy";

/**
 * "Test a Deal Policy" - would this combination need approval, and by whom?
 *
 * The point of this widget is that it must never be a second implementation of
 * the rules. It calls `resolveCeilings` and `resolveApprovalRoute` - the same
 * two functions a real quotation goes through - so if the answer here differs
 * from what happens when the deal is actually raised, that is a bug in the
 * engines rather than a discrepancy between two copies of the policy.
 *
 * It writes nothing. There is no quotation, no risk factors, no audit entry -
 * it is a question asked of the current configuration, which is exactly what
 * makes it a safe way to check a ceiling change before saving it.
 */

const Decimal = Prisma.Decimal;

export interface PolicyTestResult {
  tier: CustomerTier;
  categoryName: string;
  requestedDiscount: string;
  /** The ceiling that actually applies, and where it came from. */
  effectiveCeiling: string;
  ceilingSource: "CATEGORY_POLICY" | "TIER_DEFAULT" | "FALLBACK";
  /** Positive when the request breaches the ceiling. */
  variance: string;
  overCeiling: boolean;
  approvalRequired: boolean;
  /** The reviewers, in the order they would be asked. */
  reviewers: { stepOrder: number; role: string }[];
  reason: string;
  /** D22 - how the ceiling was arrived at, in the engine's own words. */
  steps: string[];
}

export async function testDealPolicy(
  user: AuthzUser,
  input: { tier: CustomerTier; categoryId: string; discountPercentage: string },
): Promise<PolicyTestResult> {
  // Seeing a ceiling means seeing governance, which is the same bar as reading
  // the risk detail behind an approval.
  assertCan(user, "view", "riskDetail");

  const discount = new Decimal(input.discountPercentage);
  if (discount.isNaN() || discount.lessThan(0) || discount.greaterThan(100)) {
    throw new ValidationError(
      "A discount is a percentage between 0 and 100.",
      "discountPercentage",
    );
  }

  const category = await prisma.productCategory.findUnique({
    where: { id: input.categoryId },
    select: { id: true, name: true },
  });
  if (!category) throw new NotFoundError(`Category ${input.categoryId} does not exist`);

  const ceilings = await resolveCeilings(input.tier, [input.categoryId]);
  const resolution = ceilings.get(input.categoryId);
  if (!resolution) throw new NotFoundError("No ceiling could be resolved for that category.");

  const overCeiling = discount.greaterThan(resolution.ceiling);

  /**
   * Routing is asked with a score of zero on purpose.
   *
   * A real quotation carries a risk score built from margin, delivery and
   * customer history - none of which exist for a hypothetical line. Passing
   * zero asks the narrower question this widget is actually about: given only
   * the discount and the ceiling, who has to look at it? Any real deal can
   * therefore need *more* review than this predicts, never less.
   */
  const route = resolveApprovalRoute({
    steps: await loadActiveApprovalSteps(),
    score: 0,
    anyLineOverCeiling: overCeiling,
    maxLineDiscount: discount,
  });

  return {
    tier: input.tier,
    categoryName: category.name,
    requestedDiscount: discount.toFixed(2),
    effectiveCeiling: resolution.ceiling.toFixed(2),
    ceilingSource: resolution.source,
    variance: discount.minus(resolution.ceiling).toFixed(2),
    overCeiling,
    approvalRequired: route.required,
    reviewers: route.steps.map((s) => ({ stepOrder: s.stepOrder, role: s.approverRole })),
    reason: route.reason,
    steps: resolution.steps,
  };
}

/**
 * The two dropdowns the tester needs, for a caller who may not read the rest
 * of the configuration.
 *
 * A Sales Rep holds `riskDetail` - they have to be able to see why their own
 * deal needs approval - but not `report`, which is the bar the configuration
 * overview sets. So they can legitimately ask "would this need approval?"
 * without being able to read the catalogue, the warehouses or the teams. This
 * returns only what the question needs.
 */
export async function listPolicyTestInputs(user: AuthzUser): Promise<{
  categories: { id: string; name: string }[];
  tiers: string[];
}> {
  assertCan(user, "view", "riskDetail");

  const [categories, tiers] = await Promise.all([
    prisma.productCategory.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.discountTier.findMany({ orderBy: { tier: "asc" }, select: { tier: true } }),
  ]);

  return { categories, tiers: tiers.map((t) => t.tier) };
}
