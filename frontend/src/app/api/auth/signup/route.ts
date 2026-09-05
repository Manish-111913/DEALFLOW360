import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { EmailTakenError, internalSignupSchema, registerInternalUser } from "@dealflow/backend";
import { badRequest, conflict } from "@/lib/http";

/**
 * Internal signup. §A1 and step 1 of the Quick Test Flow both require it.
 *
 * Portal users are never created here — they are provisioned by staff and
 * authenticate by magic link (D18).
 */
export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return badRequest("Expected a JSON body");
  }

  try {
    const input = internalSignupSchema.parse(payload);
    const user = await registerInternalUser(input);
    return NextResponse.json(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return badRequest("Invalid signup details", error.issues);
    }
    if (error instanceof EmailTakenError) {
      return conflict(error.message);
    }
    throw error;
  }
}
