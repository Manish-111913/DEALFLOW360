/**
 * Indian digit grouping: the last three digits, then pairs.
 *
 *   12000   -> 12,000
 *   704000  -> 7,04,000
 *   2016026 -> 20,16,026
 *
 * `toLocaleString("en-IN")` does the same thing but depends on the runtime's
 * ICU data, and these amounts are rendered on the server and again on
 * hydration - so doing it by hand keeps the two identical rather than risking a
 * mismatch that React would have to repair.
 *
 * This started life inside the billing screen. Every screen shows money now, so
 * it lives here instead of being copied.
 */
export function formatIndian(amount: number): string {
  const rounded = Math.round(Math.abs(amount));
  const digits = String(rounded);
  const sign = amount < 0 ? "-" : "";

  if (digits.length <= 3) return sign + digits;

  const lastThree = digits.slice(-3);
  const rest = digits.slice(0, -3);
  return sign + rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + lastThree;
}

/**
 * "₹7,04,000" from either a number or the decimal string the API sends.
 *
 * Amounts cross the wire as strings because they are Prisma Decimals - turning
 * them into JavaScript numbers earlier would risk precision on totals that are
 * meant to be exact.
 */
export function formatRupees(amount: number | string): string {
  const value = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(value)) return "—";
  return "₹" + formatIndian(value);
}

/** The same, with paise - for invoice lines and credit notes. */
export function formatRupeesExact(amount: number | string): string {
  const value = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(value)) return "—";
  const whole = Math.trunc(Math.abs(value));
  const paise = Math.round((Math.abs(value) - whole) * 100);
  return (
    (value < 0 ? "-" : "") +
    "₹" +
    formatIndian(whole) +
    "." +
    String(paise).padStart(2, "0")
  );
}

/**
 * Large amounts the way Indian business writes them - ₹8.40 L, ₹1.24 Cr.
 *
 * The screens use this for headline figures and the exact form for anything
 * that has to reconcile.
 */
export function formatCompact(amount: number | string): string {
  const value = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 10_000_000) return "₹" + (value / 10_000_000).toFixed(2) + " Cr";
  if (abs >= 100_000) return "₹" + (value / 100_000).toFixed(2) + " L";
  return formatRupees(value);
}
