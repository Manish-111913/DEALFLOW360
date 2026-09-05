/**
 * Indian digit grouping: the last three digits, then pairs.
 *
 *   12000  -> 12,000
 *   14400  -> 14,400
 *   704000 -> 7,04,000
 *
 * The source screen used `toLocaleString("en-IN")`, which does the same thing
 * but depends on the runtime's ICU data. Doing it by hand keeps the server and
 * the browser producing identical strings, so a server-rendered amount cannot
 * disagree with the one React renders on hydration.
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

/** The same, as rupees with two decimal places - "₹14,400.00". */
export function formatRupees(amount: number): string {
  return "₹" + formatIndian(amount) + ".00";
}
