import { NextResponse } from "next/server";
import { removeCategoryCeiling, setCategoryCeiling, setTierCeiling } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { badRequest, handleServiceError, requireUser } from "@/lib/http";

const TIERS = ["BRONZE", "SILVER", "GOLD"] as const;
type Tier = (typeof TIERS)[number];

/**
 * Discount ceilings - the tier defaults and the category overrides on top.
 *
 * One route because they are one decision from the screen's point of view:
 * "what is the most anyone may discount here". Which of the two it writes is
 * decided by whether a category is named, exactly as the resolution order
 * works - a category ceiling overrides its tier's default.
 *
 * D16: this is the Sales Manager's to change, not only the Admin's. The check
 * is inside the services.
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    requireUser(user);

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return badRequest("Expected a JSON body");
    }

    const { tier, categoryId, maxDiscount, isActive } =
      (payload as {
        tier?: unknown;
        categoryId?: unknown;
        maxDiscount?: unknown;
        isActive?: unknown;
      }) ?? {};

    if (!TIERS.includes(tier as Tier)) {
      return badRequest(`tier must be one of ${TIERS.join(", ")}`);
    }
    if (typeof maxDiscount !== "string") {
      return badRequest("maxDiscount must be a percentage string");
    }

    if (categoryId === undefined || categoryId === null) {
      const row = await setTierCeiling(user, {
        tier: tier as Tier,
        maxDiscount,
        isActive: typeof isActive === "boolean" ? isActive : undefined,
      });
      return NextResponse.json({ id: row.id, scope: "tier" });
    }

    if (typeof categoryId !== "string" || !categoryId) {
      return badRequest("categoryId must be a category id");
    }

    const row = await setCategoryCeiling(user, {
      tier: tier as Tier,
      categoryId,
      maxDiscount,
    });
    return NextResponse.json({ id: row.id, scope: "category" });
  } catch (error) {
    return handleServiceError(error);
  }
}

/** Retire an override so the tier default applies again. */
export async function DELETE(request: Request) {
  try {
    const user = await getCurrentUser();
    requireUser(user);

    const policyId = new URL(request.url).searchParams.get("policyId");
    if (!policyId) return badRequest("policyId is required");

    await removeCategoryCeiling(user, policyId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleServiceError(error);
  }
}
