/**
 * The one place in the frontend that reads the host clock.
 *
 * D3 says business time comes from `currentBusinessTime()` so the demo can time
 * travel, and the lint rule enforces it. This module is the frontend's
 * equivalent of `backend/src/clock.ts`: a single exempted entry point, so a
 * bare `new Date()` still cannot appear anywhere else.
 *
 * Nothing here feeds a calculation. It only stamps "you did this just now" on
 * screen - the approvals screen writes the moment a decision was taken.
 *
 * AT BACKEND INTEGRATION: this should read the server's business time rather
 * than the browser's, so a time-travelled demo stamps the travelled time. Until
 * the screens are wired to the API there is nothing to ask.
 */

/** "02:41 PM" - the format the approval chain shows. */
export function displayTimeNow(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * "UTC 15:06:26" - the ticking readout in the sign-in window's title bar.
 *
 * Formatted by hand rather than with toLocaleTimeString, because the server
 * renders this markup too: any locale-dependent formatting would produce a
 * different string on the server than in the browser and hydration would
 * complain. Zero-padded UTC digits are the same everywhere.
 */
export function displayUtcClock(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `UTC ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
}
