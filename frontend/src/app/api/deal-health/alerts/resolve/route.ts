import { NextResponse } from "next/server";
import { resolveAlertAs } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { badRequest, handleServiceError, requireUser } from "@/lib/http";

/**
 * Close an open alert on a deal.
 *
 * The counterpart to escalation, and the reason the board could previously only
 * grow: every escalation wrote an alert and nothing in the product could ever
 * clear one, so the "N open" count on each row only ever went up.
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

    const { alertId } = (payload as { alertId?: unknown }) ?? {};
    if (typeof alertId !== "string" || !alertId) {
      return badRequest("alertId is required");
    }

    const quotationId = await resolveAlertAs(user, alertId);
    return NextResponse.json({ ok: true, quotationId });
  } catch (error) {
    return handleServiceError(error);
  }
}
