import { NextResponse } from "next/server";
import { cancelSubscription, changeSubscriptionQuantity } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { badRequest, handleServiceError, requireUser } from "@/lib/http";

/**
 * Change a subscription's seat count, or cancel it.
 *
 * Proration is the service's business, not this route's - it decides what the
 * mid-cycle change is worth and writes the adjustment.
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

    const { subscriptionId, action, quantity, reason } =
      (payload as {
        subscriptionId?: unknown;
        action?: unknown;
        quantity?: unknown;
        reason?: unknown;
      }) ?? {};

    if (typeof subscriptionId !== "string" || !subscriptionId) {
      return badRequest("subscriptionId is required");
    }

    if (action === "cancel") {
      // The service requires a reason: a cancellation may raise a credit note,
      // and an unexplained credit is not something to write silently.
      if (typeof reason !== "string" || !reason.trim()) {
        return badRequest("A reason is required to cancel a subscription");
      }
      const result = await cancelSubscription({ subscriptionId, user, reason });
      return NextResponse.json(result);
    }

    if (action === "changeQuantity") {
      if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) {
        return badRequest("quantity must be a positive whole number");
      }
      const result = await changeSubscriptionQuantity({
        subscriptionId,
        newQuantity: quantity,
        user,
      });
      return NextResponse.json(result);
    }

    return badRequest('action must be "changeQuantity" or "cancel"');
  } catch (error) {
    return handleServiceError(error);
  }
}
