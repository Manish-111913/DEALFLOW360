import { Prisma } from "../generated/prisma/client";
import type { CustomerTier } from "../generated/prisma/enums";
import { currentBusinessTime } from "../clock";
import { prisma } from "../db";
import { getSettings } from "../settings";

/**
 * D10 — discount ceiling resolution, in three steps.
 *
 *   1. A category-specific policy for this tier ("Gold buys Services at 10%")
 *   2. Otherwise the tier's own default        ("Gold is 15% generally")
 *   3. Otherwise the configured fallback
 *
 * §A3 defines the first two levels separately, and the category one is an
 * *override*, not the only level. Without step 2 a product whose category has
 * no policy row would have no ceiling at all, and every line in that category
 * would pass governance vacuously.
 *
 * The fallback defaults to 0, deliberately: if configuration is missing
 * entirely, every discount reads as a violation and a human is asked. Failing
 * loud beats silently approving an unchecked discount.
 */

const Decimal = Prisma.Decimal;

export type CeilingSource = "CATEGORY_POLICY" | "TIER_DEFAULT" | "FALLBACK";

export interface CeilingResolution {
  ceiling: Prisma.Decimal;
  source: CeilingSource;
  policyId: string | null;
  /** D22 — how this ceiling was arrived at. */
  steps: string[];
}

/**
 * Resolve ceilings for many categories at once.
 *
 * The recompute pipeline runs on every keystroke-ish edit, so resolving each
 * line with its own round trip would make a large quotation quadratic.
 */
export async function resolveCeilings(
  tier: CustomerTier | null,
  categoryIds: string[],
): Promise<Map<string, CeilingResolution>> {
  const unique = [...new Set(categoryIds)];
  const result = new Map<string, CeilingResolution>();
  if (unique.length === 0) return result;

  const { discountFallbackCeiling } = await getSettings();
  const now = currentBusinessTime();

  if (!tier) {
    // Cannot happen through createQuotation, which refuses a tier-less
    // customer, but a ceiling of "unknown" must never read as "unlimited".
    for (const categoryId of unique) {
      result.set(categoryId, {
        ceiling: discountFallbackCeiling,
        source: "FALLBACK",
        policyId: null,
        steps: ["Customer has no tier; using the configured fallback ceiling"],
      });
    }
    return result;
  }

  const [policies, tierDefault] = await Promise.all([
    prisma.discountPolicy.findMany({
      where: {
        tier,
        categoryId: { in: unique },
        isActive: true,
        AND: [
          { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
          { OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
        ],
      },
      include: { category: { select: { name: true } } },
    }),
    prisma.discountTier.findFirst({ where: { tier, isActive: true } }),
  ]);

  const byCategory = new Map(policies.map((p) => [p.categoryId, p]));

  for (const categoryId of unique) {
    const policy = byCategory.get(categoryId);

    if (policy) {
      result.set(categoryId, {
        ceiling: policy.maxDiscount,
        source: "CATEGORY_POLICY",
        policyId: policy.id,
        steps: [
          `${tier} policy for ${policy.category.name} sets the ceiling at ${policy.maxDiscount.toFixed(2)}%`,
        ],
      });
      continue;
    }

    if (tierDefault) {
      result.set(categoryId, {
        ceiling: tierDefault.defaultMaxDiscount,
        source: "TIER_DEFAULT",
        policyId: null,
        steps: [
          `No category policy for this ${tier} line`,
          `${tier} default ceiling is ${tierDefault.defaultMaxDiscount.toFixed(2)}%`,
        ],
      });
      continue;
    }

    result.set(categoryId, {
      ceiling: discountFallbackCeiling,
      source: "FALLBACK",
      policyId: null,
      steps: [
        `No category policy and no ${tier} default configured`,
        `Using the fallback ceiling of ${discountFallbackCeiling.toFixed(2)}%`,
      ],
    });
  }

  return result;
}

/** Single-category convenience, for screens that price one line at a time. */
export async function resolveDiscountCeiling(
  tier: CustomerTier | null,
  categoryId: string,
): Promise<CeilingResolution> {
  const map = await resolveCeilings(tier, [categoryId]);
  return (
    map.get(categoryId) ?? {
      ceiling: new Decimal(0),
      source: "FALLBACK",
      policyId: null,
      steps: ["No ceiling could be resolved"],
    }
  );
}
