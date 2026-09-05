import { currentBusinessTime } from "../clock";
import { prisma } from "../db";

/**
 * Memoisation for the deal-scoped AI cards.
 *
 * This exists because Gemini's free tier allows 20 generate_content requests
 * per day per model, which a single demo can exhaust: opening one deal renders
 * a summary, a next best action and a scenario comparison, and navigating back
 * to it would spend three more. Regenerating an identical answer for an
 * unchanged deal is pure waste at any quota, and at this one it is the
 * difference between a working demo and an error card.
 *
 * The key is the deal's own `updatedAt`, not a timer. Every mutation runs
 * through `recomputeQuotation`, which touches the row, so a cached answer is
 * evicted exactly when the thing it describes changes - and never lingers
 * after a discount edit, which is the case that would actually mislead someone.
 *
 * Scoped per user as well as per deal: two roles see different context (a rep
 * has no deal-health section), so they must not share an answer.
 *
 * In-memory and per-process, which is the right size for this. It is a cost
 * optimisation, not a store: a restart costs one regeneration.
 *
 * Times come from `currentBusinessTime()` rather than the host clock (D3). That
 * is not just rule-following: when the demo travels forward in time the deals
 * themselves age, so their cached descriptions should expire with them.
 */

interface Entry<T> {
  value: T;
  /** The quotation's updatedAt when this was generated. */
  version: string;
  expiresAt: number;
}

const TTL_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 200;

const store = new Map<string, Entry<unknown>>();

async function versionOf(quotationId: string): Promise<string> {
  const row = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: { updatedAt: true, lastActivityAt: true },
  });
  if (!row) return "missing";
  // lastActivityAt moves on negotiation and approval events that do not
  // necessarily touch updatedAt, so both are part of the identity.
  return `${row.updatedAt.getTime()}:${row.lastActivityAt.getTime()}`;
}

/**
 * Return the cached answer for this (feature, user, deal, version), or compute
 * and store one.
 *
 * A failure is never cached: an outage or a rate limit must not become the
 * remembered answer for the next quarter of an hour.
 */
export async function cached<T>(
  feature: string,
  userId: string,
  quotationId: string,
  compute: () => Promise<T>,
): Promise<T> {
  const key = `${feature}:${userId}:${quotationId}`;
  const version = await versionOf(quotationId);
  const now = currentBusinessTime().getTime();

  const hit = store.get(key);
  if (hit && hit.version === version && hit.expiresAt > now) {
    return hit.value as T;
  }

  const value = await compute();

  // Cheapest possible bound: when full, drop the oldest inserted key. Map
  // preserves insertion order, so this is one line and needs no LRU bookkeeping.
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { value, version, expiresAt: now + TTL_MS });

  return value;
}

/** Test seam. Not exported through the barrel. */
export function clearAiCache(): void {
  store.clear();
}
