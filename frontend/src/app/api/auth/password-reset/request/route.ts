import { NextResponse } from "next/server";
import { z } from "zod";
import { requestPasswordReset } from "@dealflow/backend";
import { badRequest } from "@/lib/http";

const schema = z.object({ email: z.string().email() });

/**
 * "Send Recovery Link" on the Forgot Password tab.
 *
 * Always answers the same way. Whether the address has an account, belongs to a
 * portal customer, or has never been seen, the response is an unremarkable
 * success - otherwise this endpoint is a free tool for discovering who our
 * customers are.
 *
 * There is no mail transport in this build, so a development server returns the
 * link in the response and the screen displays it. That is gated on NODE_ENV:
 * in production the token never leaves the database, and wiring a mailer is the
 * one step that makes this flow complete.
 */
export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return badRequest("Expected a JSON body");
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) return badRequest("A valid email address is required");

  const issued = await requestPasswordReset(parsed.data.email);

  const devLink =
    process.env.NODE_ENV !== "production" && issued.rawToken
      ? `/login?tab=reset&token=${encodeURIComponent(issued.rawToken)}`
      : null;

  return NextResponse.json({
    // Deliberately constant. See above.
    ok: true,
    expiresAt: devLink ? issued.expiresAt : null,
    devLink,
  });
}
