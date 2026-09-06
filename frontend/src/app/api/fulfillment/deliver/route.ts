import { NextResponse } from "next/server";
import { recordDeliveryAs } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { badRequest, handleServiceError, requireUser } from "@/lib/http";

/**
 * Record that a shipment arrived.
 *
 * The date is accepted rather than assumed, because arrivals are usually
 * entered after the fact and defaulting to "now" would quietly erase every
 * late delivery - the service compares this against the promised date to
 * decide whether the deal's delivery signal has slipped.
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

    const { shipmentId, deliveredAt } =
      (payload as { shipmentId?: unknown; deliveredAt?: unknown }) ?? {};

    if (typeof shipmentId !== "string" || !shipmentId) {
      return badRequest("shipmentId is required");
    }

    let arrived: Date | undefined;
    if (typeof deliveredAt === "string" && deliveredAt) {
      arrived = new Date(deliveredAt);
      if (Number.isNaN(arrived.getTime())) {
        return badRequest("deliveredAt is not a valid date");
      }
    }

    const result = await recordDeliveryAs(user, { shipmentId, deliveredAt: arrived });
    return NextResponse.json(result);
  } catch (error) {
    return handleServiceError(error);
  }
}
