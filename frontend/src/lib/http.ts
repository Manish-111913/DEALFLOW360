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
