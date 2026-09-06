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

/**
 * The identity of everything the answer was built from.
 *
 * The quotation's own timestamps are not enough. The context a card is generated
 * against also carries fulfilment, billing, the customer's tier and the
 * company-wide settings the engines read - and none of those touch the quotation
 * row when they change. So dispatching a shipment, recording a payment, or
 * tightening a discount ceiling would all leave yesterday's summary standing,
 * still confidently describing a state that no longer exists. That is the one
 * failure mode a cache like this must not have: being wrong rather than slow.
 *
 * Six indexed reads to avoid one model call is a trade worth making every time.
 */
async function versionOf(quotationId: string): Promise<string> {
  const row = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: { updatedAt: true, lastActivityAt: true, customerId: true },
  });
  if (!row) return "missing";

  const [shipments, invoices, allocations, customer, settings] = await Promise.all([
    prisma.shipment.aggregate({ where: { quotationId }, _max: { updatedAt: true } }),
    prisma.invoice.aggregate({ where: { quotationId }, _max: { updatedAt: true } }),
    prisma.fulfillmentAllocation.aggregate({ where: { quotationId }, _max: { updatedAt: true } }),
    prisma.customer.findUnique({ where: { id: row.customerId }, select: { updatedAt: true } }),
    // Settings have no per-deal row, so the whole table's high-water mark stands
    // in: any configuration change invalidates every cached card, which is the
    // safe direction to be wrong in.
    prisma.systemSetting.aggregate({ _max: { updatedAt: true } }),
  ]);

  const stamp = (value: Date | null | undefined) => (value ? value.getTime() : 0);

  // lastActivityAt moves on negotiation and approval events that do not
  // necessarily touch updatedAt, so both are part of the identity.
  return [
    row.updatedAt.getTime(),
    row.lastActivityAt.getTime(),
    stamp(shipments._max.updatedAt),
    stamp(invoices._max.updatedAt),
    stamp(allocations._max.updatedAt),
    stamp(customer?.updatedAt),
    stamp(settings._max.updatedAt),
  ].join(":");
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
