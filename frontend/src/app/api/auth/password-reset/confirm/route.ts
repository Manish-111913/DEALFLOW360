import { NextResponse } from "next/server";
import { z } from "zod";
import { resetPassword } from "@dealflow/backend";
import { badRequest } from "@/lib/http";

const schema = z.object({
  token: z.string().min(1),
  password: z.string().min(1),
});

/** What the user is told for each way a reset can fail. */
const MESSAGES = {
  unknown: "This recovery link is not valid. Please request a new one.",
  expired: "This recovery link has expired. Please request a new one.",
  already_used:
    "This recovery link has already been used. Please request a new one.",
  weak_password: "That password does not meet the security policy.",
} as const;

/**
 * "Update Password & Sign In" on the Reset tab.
 *
 * A weak password comes back as 400 with the failing rules listed, and the link
 * is still live - the service checks the policy before burning the token, so a
 * rejected password does not cost the user their only way back in.
 */
export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return badRequest("Expected a JSON body");
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) return badRequest("A recovery token and a new password are required");

  const result = await resetPassword(parsed.data.token, parsed.data.password);

  if (!result.ok) {
    return NextResponse.json(
      { error: MESSAGES[result.reason], problems: result.problems ?? [] },
      { status: result.reason === "weak_password" ? 400 : 410 },
    );
  }

  // The email is returned so the screen can prefill sign-in with it.
  return NextResponse.json({ ok: true, email: result.email });
}
