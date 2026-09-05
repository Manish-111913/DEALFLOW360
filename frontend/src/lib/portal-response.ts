import { forbidden, notFound, unauthorized } from "@/lib/http";

/**
 * Map a portal service status onto a response.
 *
 * 403 rather than 404 for someone else quotation is deliberate: an empty page
 * would read as "found but hidden", where 403 correctly says "not yours".
 */
export function portalError(status: 401 | 403 | 404) {
  if (status === 401) return unauthorized();
  if (status === 404) return notFound();
  return forbidden("This quotation belongs to another customer");
}
