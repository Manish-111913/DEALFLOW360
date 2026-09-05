import { NextResponse } from "next/server";
import { summariseDeal } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { handleAiError } from "@/lib/ai-http";
import { forbidden, requireUser } from "@/lib/http";

/**
 * AI Deal Summary (§7).
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

    return NextResponse.json(await summariseDeal(user, id));
  } catch (error) {
    return handleAiError(error);
  }
}
