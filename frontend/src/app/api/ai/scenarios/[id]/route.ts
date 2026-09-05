import { NextResponse } from "next/server";
import { proposeScenarios } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { handleAiError } from "@/lib/ai-http";
import { forbidden, requireUser } from "@/lib/http";

/**
 * What-if Deal Simulator (§5).
 *
 * The quotation id is the only input. Everything the answer is built from is
 * fetched server-side through the services that enforce this user's scope, so
 * asking about a deal the caller cannot see is refused before Gemini is
 * reached - the model is never given data the user could not already read.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    requireUser(user);
    if (user.kind === "PORTAL") return forbidden("Deal Intelligence is an internal feature");

    // Wrapped rather than returned bare, so the shape matches the other AI
    // routes and can grow a field later without breaking the client.
    return NextResponse.json({ scenarios: await proposeScenarios(user, id) });
  } catch (error) {
    return handleAiError(error);
  }
}
