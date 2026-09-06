import { NextResponse } from "next/server";
import { dispatchShipmentAs } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { badRequest, handleServiceError, requireUser } from "@/lib/http";

/**
 * Send everything reserved at one warehouse out as a shipment.
 *
 * One shipment per warehouse is the unit the allocator planned and costed, so
 * the route takes a warehouse rather than a list of lines - dispatching "half a
 * depot" is not a thing the plan can describe.
 *
 * The promised delivery date is optional but consequential: it is the promise
 * half of the delivery-slippage signal, and a shipment sent without one can
 * never be recorded as late.
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

    const { quotationId, warehouseId, estimatedDeliveryDate } =
      (payload as {
        quotationId?: unknown;
        warehouseId?: unknown;
        estimatedDeliveryDate?: unknown;
      }) ?? {};

    if (typeof quotationId !== "string" || !quotationId) {
      return badRequest("quotationId is required");
    }
    if (typeof warehouseId !== "string" || !warehouseId) {
      return badRequest("warehouseId is required");
    }

    let promisedFor: Date | null = null;
    if (typeof estimatedDeliveryDate === "string" && estimatedDeliveryDate) {
      promisedFor = new Date(estimatedDeliveryDate);
      if (Number.isNaN(promisedFor.getTime())) {
        return badRequest("estimatedDeliveryDate is not a valid date");
      }
    }

    const result = await dispatchShipmentAs(user, {
      quotationId,
      warehouseId,
      estimatedDeliveryDate: promisedFor,
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleServiceError(error);
  }
}
