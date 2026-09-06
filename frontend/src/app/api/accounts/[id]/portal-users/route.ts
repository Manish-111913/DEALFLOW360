import { NextResponse } from "next/server";
import { createPortalUserAs } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { badRequest, handleServiceError, requireUser } from "@/lib/http";

/**
 * Add a buyer who may sign in to the customer portal for this account.
 *
 * A password is optional. With one, the contact signs in at the portal's own
 * login screen; without one, they are sent a single-use link instead. The
 * contact is the durable identity either way - which is why creating one and
 * issuing a link stay two separate acts.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    requireUser(user);

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return badRequest("Expected a JSON body");
    }

    const { email, name, password } =
      (payload as { email?: unknown; name?: unknown; password?: unknown }) ?? {};
    if (typeof email !== "string" || !email.trim()) return badRequest("email is required");
    if (typeof name !== "string" || !name.trim()) return badRequest("name is required");
    if (password !== undefined && typeof password !== "string") {
      return badRequest("password must be text");
    }

    const created = await createPortalUserAs(user, {
      customerId: id,
      email,
      name,
      password: password?.trim() || undefined,
    });
    return NextResponse.json({ id: created.id, email: created.email, name: created.name });
  } catch (error) {
    return handleServiceError(error);
  }
}
