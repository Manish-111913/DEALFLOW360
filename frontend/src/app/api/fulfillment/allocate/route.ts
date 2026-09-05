import { NextResponse } from "next/server";
import { allocateFulfillment, overrideAllocation } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { badRequest, handleServiceError, requireUser } from "@/lib/http";

/**
 * Accept the recommended split, or override it with explicit quantities.
 *
 * Both are the same decision from the screen's point of view - "this is how the
 * order ships" - so they share a route and differ by whether `picks` is
 * present. Capability (D17: Finance/Operations, not the rep) is checked inside
 * both services.
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

    const { quotationId, picks, reason } =
      (payload as { quotationId?: unknown; picks?: unknown; reason?: unknown }) ?? {};

    if (typeof quotationId !== "string" || !quotationId) {
      return badRequest("quotationId is required");
    }

    // No picks means "accept the recommendation"; picks mean "ship it this way
    // instead", which the service records as a deliberate commercial override.
    if (picks === undefined) {
      const result = await allocateFulfillment({ quotationId, user });
      return NextResponse.json(result);
    }

    if (!Array.isArray(picks) || picks.length === 0) {
      return badRequest("picks must be a non-empty array");
    }
    if (typeof reason !== "string" || !reason.trim()) {
      return badRequest("A reason is required when overriding the recommended split");
    }

    const result = await overrideAllocation({ quotationId, user, picks, reason });
    return NextResponse.json(result);
  } catch (error) {
    return handleServiceError(error);
  }
}
