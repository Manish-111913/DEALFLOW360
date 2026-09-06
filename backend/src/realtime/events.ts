import type { Prisma } from "../generated/prisma/client";
import { prisma } from "../db";

/**
 * Deal events, and how they cross between processes.
 *
 * DealFlow360 runs as two clients of one business core - the staff workspace
 * and the customer portal - in two separate Node processes. An in-process event
 * emitter therefore cannot connect them: a counter-offer submitted on the
 * portal has to reach a sales manager's browser attached to the other process.
 *
 * Postgres carries the events, because Postgres is already the one thing both
 * processes share. `NOTIFY` is transactional: an event published inside the
 * transaction that changed the state is delivered only if that transaction
 * commits, and is delivered exactly once. That is the property that matters
 * here - it makes it impossible to announce an approval that rolled back, which
 * a separate message broker would happily do.
 *
 * The payload is deliberately thin. It says what changed and on which
 * quotation, never what the new values are: every client re-reads through its
 * own authorised endpoint, so an event can never become a channel for data a
 * recipient was not allowed to fetch.
 */

export const DEAL_EVENT_CHANNEL = "dealflow_events";

export type DealEventType =
  | "QUOTE_UPDATED"
  | "NEGOTIATION_SUBMITTED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_COMPLETED"
  | "QUOTE_CONFIRMED";

export interface DealEvent {
  type: DealEventType;
  quotationId: string;
  /** Scoping key, so the hub can route to that customer's portal session. */
  customerId: string;
  /** Who owns the deal internally, for team-scoped routing. */
  salesRepId: string | null;
  /** Epoch ms, from business time (D3). */
  at: number;
}

/** Postgres NOTIFY payloads are capped at 8000 bytes; ours are far below. */
function encode(event: DealEvent): string {
  return JSON.stringify(event);
}

export function decodeDealEvent(raw: string): DealEvent | null {
  try {
    const parsed = JSON.parse(raw) as DealEvent;
    return typeof parsed?.quotationId === "string" && typeof parsed?.type === "string"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/**
 * Publish an event.
 *
 * Pass the transaction client when publishing alongside a state change, so the
 * two commit or fail together. Called without one it publishes immediately,
 * which is right for events that describe something already committed.
 *
 * Never throws into the caller: a realtime notification failing is not a reason
 * for a customer's confirmation to fail. The application is required to work
 * without this transport at all.
 */
export async function publishDealEvent(
  event: DealEvent,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const client = tx ?? prisma;
  try {
    // $executeRaw parameterises, so the payload cannot break out of the string.
    await client.$executeRaw`SELECT pg_notify(${DEAL_EVENT_CHANNEL}, ${encode(event)})`;
  } catch {
    // Deliberately swallowed. See above.
  }
}
