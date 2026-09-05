import { NextResponse } from "next/server";
import { acceptUpsell, assertQuotationVisible, dismissUpsell } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { badRequest, handleServiceError, requireUser } from "@/lib/http";

/**
 * Accept or dismiss one upsell suggestion (F-3).
 *
 * Accepting adds the product to the quotation, which re-runs the D21 recompute
 * pipeline - margin, risk, approval routing - so the caller gets back a
 * quotation that may now need approval it did not need a moment ago. That is
 * the point of doing it through the service rather than inserting a line.
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

    const { quotationId, productId, action, quantity } =
      (payload as {
        quotationId?: unknown;
        productId?: unknown;
        action?: unknown;
        quantity?: unknown;
      }) ?? {};

    if (typeof quotationId !== "string" || !quotationId) {
      return badRequest("quotationId is required");
    }
    if (typeof productId !== "string" || !productId) {
      return badRequest("productId is required");
    }

    // A rep may only upsell into a quotation they can already see.
    await assertQuotationVisible(user, quotationId);

    if (action === "dismiss") {
      const dismissed = await dismissUpsell({ quotationId, productId });
      return NextResponse.json({ dismissed });
    }

    if (action === "accept") {
      const result = await acceptUpsell({
        quotationId,
        productId,
        quantity: typeof quantity === "number" && quantity > 0 ? quantity : undefined,
        actorId: user.id,
      });
      return NextResponse.json(result ?? { accepted: true });
    }

    return badRequest('action must be "accept" or "dismiss"');
  } catch (error) {
    return handleServiceError(error);
  }
}
