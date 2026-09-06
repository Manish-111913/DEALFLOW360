import { NextResponse } from "next/server";
import { assertQuotationVisible, planFulfillmentAs } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { badRequest, handleServiceError, requireUser } from "@/lib/http";

/**
 * Work out how an approved order should ship, without reserving anything.
 *
 * Separate from /allocate because they are different commitments: this one is
 * advisory and can be run again whenever stock moves, while allocate takes the
 * units off the shelf. The screen offers this when an order has no plan yet -
 * which, before this route existed, was a state nothing could get an order out
 * of.
 *
 * `assertQuotationVisible` is here rather than in the service for the reason it
 * always is: capability and row scope are two different questions, and
 * `planFulfillmentAs` only answers the first.
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

    const { quotationId } = (payload as { quotationId?: unknown }) ?? {};
    if (typeof quotationId !== "string" || !quotationId) {
      return badRequest("quotationId is required");
    }

    await assertQuotationVisible(user, quotationId);
    const result = await planFulfillmentAs(user, quotationId);

    return NextResponse.json({
      planId: result.planId,
      shipmentCount: result.recommended.shipmentCount,
      shippingCost: String(result.recommended.shippingCost),
    });
  } catch (error) {
    return handleServiceError(error);
  }
}
