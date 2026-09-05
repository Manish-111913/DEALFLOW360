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
} as const;
