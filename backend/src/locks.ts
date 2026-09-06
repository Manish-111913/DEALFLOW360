/**
 * Postgres advisory lock keys, in one place.
 *
 * These serialise operations that would otherwise race — appending to the audit
 * chain, allocating a quote number, reserving stock. Two features accidentally
 * choosing the same integer would deadlock or silently over-serialise, and the
 * collision would only show under load. Keeping them together makes that
 * impossible to do by accident.
 */
export const ADVISORY_LOCK = {
  auditChain: 4_607_360,
  quoteNumber: 4_607_361,
  stockAllocation: 4_607_362,
  billingRun: 4_607_363,
  /**
   * Taken with a second key derived from the quotation id, so two customers
   * negotiating at the same time do not queue behind each other - only two
   * submissions on the *same* quotation do.
   */
  negotiationSubmit: 4_607_364,
} as const;

/**
 * A stable 32-bit key from a cuid, for the second half of a two-key advisory
 * lock.
 *
 * Hashed in JavaScript rather than with Postgres's `hashtext`, which is an
 * internal function with no compatibility promise. FNV-1a is small, stable
 * across processes, and collisions only ever cost a little over-serialisation.
 */
export function lockKeyFor(id: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  // Postgres advisory keys are signed 32-bit.
  return hash | 0;
}
