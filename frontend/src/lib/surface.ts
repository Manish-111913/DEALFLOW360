import { redirect } from "next/navigation";

/**
 * Which of DealFlow360's two faces this process serves.
 *
 * The same codebase runs twice: the internal workspace on :3001 and the
 * customer portal on :3000. They are two clients of one business core and one
 * database - never of each other - and all that differs between the processes
 * is which surface they present and which session cookie they carry.
 *
 * The cookie name is the part that actually matters, and it is easy to get
 * wrong. Cookies are scoped by host and ignore the port (RFC 6265): a session
 * set on localhost:3000 is sent to localhost:3001 too. So running the portal on
 * a second port does not by itself let someone be a customer in one tab and a
 * sales manager in another - the second sign-in would overwrite the first.
 * Naming each surface's cookies apart is what makes the sessions independent,
 * and it holds whatever ports they end up on.
 */

export type Surface = "internal" | "portal" | "both";

/**
 * Unset means "both", which keeps a single `npm run dev` serving the whole
 * application as it always has. The split is opt-in, so nobody has to know
 * about it to run the project.
 */
export function surface(): Surface {
  const raw = process.env.DEALFLOW_SURFACE?.trim().toLowerCase();
  if (raw === "portal") return "portal";
  if (raw === "internal") return "internal";
  return "both";
}

/**
 * The cookie prefix for this surface.
 *
 * Auth.js derives every cookie name from a prefix, so overriding it once
 * separates the whole set - session, CSRF, callback URL and the OAuth handshake
 * cookies - rather than only the session. A process serving both surfaces keeps
 * one prefix, because there is only one session to hold.
 */
export function cookiePrefix(): string {
  const which = surface();
  return which === "both" ? "dealflow" : `dealflow-${which}`;
}

/** True when this process does not serve the internal workspace. */
export function portalOnly(): boolean {
  return surface() === "portal";
}

/** True when this process does not serve the customer portal. */
export function internalOnly(): boolean {
  return surface() === "internal";
}

/**
 * Guard for an internal screen. Called by `requireInternalUser`.
 *
 * On the portal process there is no internal workspace to show, so a request
 * for one is sent to the customer's home rather than rendering a staff screen
 * on the customer's origin.
 */
export function assertServesInternal(): void {
  if (portalOnly()) redirect("/my/quotations");
}

/**
 * Guard for a customer screen.
 *
 * The mirror image: on a process dedicated to the internal workspace, the
 * customer portal is not served here. Sending them to the portal's own origin
 * would need to know its URL, so this redirects to the sign-in page, which is
 * true on both surfaces.
 */
export function assertServesPortal(): void {
  if (internalOnly()) redirect("/dashboard");
}

/**
 * Where the customer portal is served, for a link that has to be handed over.
 *
 * This is the one place the internal surface legitimately needs to name the
 * portal, and it is a URL written into an email - not a call. The two processes
 * still never talk to each other; the recipient's browser is what follows this.
 *
 * The default is deliberately narrow. In split mode the launcher pins the
 * portal to :3000, so that is what is assumed; a single process serving both
 * surfaces serves the portal at its own origin, which is why the caller's
 * origin is the fallback. Deployments set PORTAL_BASE_URL and neither guess
 * applies.
 */
export function portalBaseUrl(requestOrigin: string): string {
  const configured = process.env.PORTAL_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");

  if (internalOnly()) {
    try {
      const { protocol, hostname } = new URL(requestOrigin);
      return `${protocol}//${hostname}:3000`;
    } catch {
      return "http://localhost:3000";
    }
  }

  return requestOrigin.replace(/\/$/, "");
}
