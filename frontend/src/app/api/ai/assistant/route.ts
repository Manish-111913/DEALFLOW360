import { NextResponse } from "next/server";
import { z } from "zod";
import { answerDealQuestion } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { handleAiError } from "@/lib/ai-http";
import { badRequest, forbidden, requireUser } from "@/lib/http";

const schema = z.object({
  screen: z.string().max(40),
  quotationId: z.string().min(1).nullable().optional(),
  question: z.string().min(1).max(1000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) }))
    .max(12)
    .optional(),
});

/**
 * The Deal Assistant (§3).
 *
 * The body carries only a question, a screen and which deal is open. It cannot
 * carry facts: every number the answer uses is fetched here, through services
 * that check this user's role. A client that lied about its context would only
 * change which deal it was refused access to.
 */
export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return badRequest("Expected a JSON body");
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) return badRequest("A question and a screen are required");

  try {
    const user = await getCurrentUser();
    requireUser(user);

    // D20. The assistant reasons over margin, risk and approvals; a customer
    // identity has no business on this endpoint at all.
    if (user.kind === "PORTAL") return forbidden("Deal Intelligence is an internal feature");

    const answer = await answerDealQuestion(user, {
      screen: parsed.data.screen,
      quotationId: parsed.data.quotationId ?? null,
      question: parsed.data.question,
      history: parsed.data.history,
    });

    return NextResponse.json({ answer });
  } catch (error) {
    return handleAiError(error);
  }
}
