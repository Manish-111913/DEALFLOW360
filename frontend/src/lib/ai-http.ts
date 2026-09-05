import { NextResponse } from "next/server";
import { AiError, AI_FAILURE_MESSAGE, type AiFailure } from "@dealflow/backend";
import { handleServiceError } from "./http";

/**
 * One failure contract for every AI route (§21).
 *
 * The client is told which kind of failure it was and what to say about it,
 * and never anything else: not the upstream message, not the model name, not
 * the prompt. A Gemini error body can quote the request back, and the request
 * contains the deal context, so passing it through would leak exactly what the
 * role checks were there to protect.
 *
 * 503 for every AI failure is deliberate. The screen's job is the same in all
 * of them - say the insight is unavailable and leave the rest of the workflow
 * working - and `failure` is there for the cases where the wording differs.
 */
export function handleAiError(error: unknown): NextResponse {
  if (error instanceof AiError) {
    return NextResponse.json(
      { failure: error.failure satisfies AiFailure, error: AI_FAILURE_MESSAGE[error.failure] },
      { status: error.status },
    );
  }

  // A ForbiddenError or NotFoundError from the services underneath is a real
  // authorisation answer and keeps its own status.
  return handleServiceError(error);
}
