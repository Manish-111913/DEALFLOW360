import { NextResponse } from "next/server";
import { decideApproval } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { badRequest, handleServiceError, requireUser } from "@/lib/http";

const DECISIONS = ["APPROVE", "REJECT", "RETURN"] as const;
type Decision = (typeof DECISIONS)[number];

/**
 * Approve, reject or return one approval request.
 *
 * `decideApproval` owns the rules - who may decide, whether the request is
 * still pending, and what the decision does to the quotation - so this route
 * only validates the shape of the body.
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

    const { requestId, decision, reason } =
      (payload as { requestId?: unknown; decision?: unknown; reason?: unknown }) ?? {};

    if (typeof requestId !== "string" || !requestId) {
      return badRequest("requestId is required");
    }
    if (typeof decision !== "string" || !DECISIONS.includes(decision as Decision)) {
      return badRequest(`decision must be one of ${DECISIONS.join(", ")}`);
    }
    // Rejecting or returning without saying why leaves the rep with nothing to
    // act on, so the reason is required for both.
    if (decision !== "APPROVE" && (typeof reason !== "string" || !reason.trim())) {
      return badRequest("A reason is required when rejecting or returning");
    }

    const result = await decideApproval({
      requestId,
      decision: decision as Decision,
      user,
      reason: typeof reason === "string" ? reason : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleServiceError(error);
  }
}
