import { NextResponse } from "next/server";
import { setCustomerTierAs } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { badRequest, handleServiceError, requireUser } from "@/lib/http";

const TIERS = ["BRONZE", "SILVER", "GOLD"] as const;
type Tier = (typeof TIERS)[number];

/**
 * Move an account between tiers.
 *
 * A tier could be chosen when the account was opened and never changed again,
 * which is backwards: the tier is a commercial relationship and those move. It
 * needs a reason because it silently changes the discount ceiling every open
 * quotation on the account is checked against - a governance change wearing the
 * clothes of a contact-record edit.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    requireUser(user);

    const body = (await request.json().catch(() => ({}))) as { tier?: unknown; reason?: unknown };
    if (!TIERS.includes(body.tier as Tier)) {
      return badRequest(`tier must be one of ${TIERS.join(", ")}`);
    }
    if (typeof body.reason !== "string" || !body.reason.trim()) {
      return badRequest("A tier change needs a reason");
    }

    return NextResponse.json(
      await setCustomerTierAs(user, {
        customerId: id,
        tier: body.tier as Tier,
        reason: body.reason,
      }),
    );
  } catch (error) {
    return handleServiceError(error);
  }
}
