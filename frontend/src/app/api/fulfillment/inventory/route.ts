import { NextResponse } from "next/server";
import {
  consolidateBackorderAs,
  listConsolidatableBackordersAs,
  receiveStockAs,
} from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { badRequest, handleServiceError, requireUser } from "@/lib/http";

/**
 * Stock arriving, and the backorders it unblocks.
 *
 * These two belong together because they are one movement seen from both ends:
 * a receipt puts units on a shelf, and consolidation is what those units are
 * immediately for. Until now the product could show a backorder and never clear
 * one - the queue only ever grew, and the only way to receive stock was a script.
 *
 * D17 puts both with Finance/Operations, checked inside the services.
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    requireUser(user);
    return NextResponse.json({ backorders: await listConsolidatableBackordersAs(user) });
  } catch (error) {
    return handleServiceError(error);
  }
}

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

    const body = (payload as Record<string, unknown>) ?? {};

    // A backorder id means "the stock is here, fill this"; a receipt means "the
    // stock is here" and says nothing about who wants it.
    if (typeof body.backorderId === "string" && body.backorderId) {
      return NextResponse.json(await consolidateBackorderAs(user, body.backorderId));
    }

    const { warehouseId, productId, variantId, quantity } = body;
    if (typeof warehouseId !== "string" || !warehouseId) {
      return badRequest("warehouseId is required");
    }
    if (typeof productId !== "string" || !productId) {
      return badRequest("productId is required");
    }
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity <= 0) {
      return badRequest("quantity must be a whole number of units above zero");
    }

    return NextResponse.json(
      await receiveStockAs(user, {
        warehouseId,
        productId,
        variantId: typeof variantId === "string" && variantId ? variantId : null,
        quantity,
      }),
    );
  } catch (error) {
    return handleServiceError(error);
  }
}
