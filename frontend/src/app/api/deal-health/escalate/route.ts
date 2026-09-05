import { NextResponse } from "next/server";
import { escalateDeal } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { badRequest, handleServiceError, requireUser } from "@/lib/http";

/**
 * Escalate one deal from the health board.
 *
 * `escalateDeal` checks the "escalate" capability itself, so this route only
 * authenticates and validates the body. The note is optional, matching the
 * service.
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

    const { quotationId, note } =
      (payload as { quotationId?: unknown; note?: unknown }) ?? {};
    if (typeof quotationId !== "string" || !quotationId) {
      return badRequest("quotationId is required");
    }

    const result = await escalateDeal({
      quotationId,
      user,
      note: typeof note === "string" ? note : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleServiceError(error);
  }
}
