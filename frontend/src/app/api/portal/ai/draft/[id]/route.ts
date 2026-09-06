import { NextResponse } from "next/server";
import { draftNegotiationMessage } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { handleAiError } from "@/lib/ai-http";
import { badRequest, forbidden, requireUser } from "@/lib/http";

/** Long enough to say what you want, short enough not to be a prompt payload. */
const MAX_INTENT = 500;

/**
 * Turn "I need a better price on the laptops" into a request the seller can act on.
 *
 * It returns a DRAFT and nothing else. Nothing is submitted, no negotiation is
 * opened, and the customer still presses the button on the existing negotiation
 * form after reading what was written for them. That separation is the point: a
 * model that could open a negotiation on a customer's behalf would be putting
 * words in their mouth on a commercial record.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    requireUser(user);
    if (user.kind !== "PORTAL") {
      return forbidden("This assistant is the customer's surface");
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return badRequest("Expected a JSON body");
    }

    const { intent } = (payload as { intent?: unknown }) ?? {};
    if (typeof intent !== "string" || !intent.trim()) {
      return badRequest("Say what you would like to ask for");
    }
    if (intent.length > MAX_INTENT) {
      return badRequest(`Keep it under ${MAX_INTENT} characters`);
    }

    return NextResponse.json(await draftNegotiationMessage(user, id, { intent }));
  } catch (error) {
    return handleAiError(error);
  }
}
