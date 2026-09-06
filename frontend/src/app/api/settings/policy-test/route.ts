import { NextResponse } from "next/server";
import { testDealPolicy } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { badRequest, handleServiceError, requireUser } from "@/lib/http";

const TIERS = ["BRONZE", "SILVER", "GOLD"] as const;
type Tier = (typeof TIERS)[number];

/**
 * "Would this need approval?" - asked of the live configuration.
 *
 * Writes nothing. The service runs the same two engines a real quotation goes
 * through, so this is a rehearsal rather than a second opinion: it is the safe
 * way to check what a ceiling change will do before saving it.
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

    const { tier, categoryId, discountPercentage } =
      (payload as { tier?: unknown; categoryId?: unknown; discountPercentage?: unknown }) ?? {};

    if (!TIERS.includes(tier as Tier)) {
      return badRequest(`tier must be one of ${TIERS.join(", ")}`);
    }
    if (typeof categoryId !== "string" || !categoryId) {
      return badRequest("categoryId is required");
    }
    if (typeof discountPercentage !== "string") {
      return badRequest("discountPercentage must be a percentage string");
    }

    return NextResponse.json(
      await testDealPolicy(user, {
        tier: tier as Tier,
        categoryId,
        discountPercentage,
      }),
    );
  } catch (error) {
    return handleServiceError(error);
  }
}
