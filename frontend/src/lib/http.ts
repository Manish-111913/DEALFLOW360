import { NextResponse } from "next/server";

/**
 * Deliberate response semantics for denied access.
 *
 * 05_SECURITY.md is explicit: a portal user reaching another customer's record
 * gets a 403, not a friendlier-looking empty page. An empty page implies "found
 * but hidden"; 403 correctly implies "not yours". A 404 would leak less but
 * also lies, and the spec asks for 403 by name.
 */
export function forbidden(message = "Forbidden") {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function unauthorized(message = "Authentication required") {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function notFound(message = "Not found") {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function badRequest(message: string, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status: 400 });
}

export function conflict(message: string) {
  return NextResponse.json({ error: message }, { status: 409 });
}

/**
 * Turn a thrown domain error into the response it already describes.
 *
 * Every error the backend raises on purpose carries its own `status` -
 * ValidationError 422, NotFoundError 404, ConflictError 409, ForbiddenError
 * 403. Routes should not restate that mapping, both because it would drift and
 * because a route that forgets one turns a deliberate 403 into a 500, which
 * reads as "the server broke" rather than "you may not do that".
 *
 * Anything without a status is a genuine bug, so it is re-thrown and becomes a
 * 500 with a stack trace in the log, rather than being flattened into a
 * misleading 400.
 */
export function handleServiceError(error: unknown): NextResponse {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
  ) {
    const { status } = error as { status: number };
    const message = error instanceof Error ? error.message : "Request failed";
    return NextResponse.json({ error: message }, { status });
  }
  throw error;
}

/** The session guard every protected route starts with. */
export function requireUser<T>(user: T | null): asserts user is T {
  if (!user) throw Object.assign(new Error("Authentication required"), { status: 401 });
}
