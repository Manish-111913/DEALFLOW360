import { Client } from "pg";
import { DEAL_EVENT_CHANNEL, decodeDealEvent, type DealEvent } from "./events";

/**
 * The LISTEN side of the deal event bus.
 *
 * A dedicated pg connection rather than one from Prisma's pool: a listening
 * connection is long-lived and must not be handed back to the pool between
 * queries, or the LISTEN registration goes with it.
 *
 * Reconnection is not optional. A dropped listener is silent - no error reaches
 * a user, events simply stop arriving - which is the worst way for a realtime
 * feature to fail. It retries with a bounded backoff and says so on stderr.
 */

export interface DealEventSubscription {
  close: () => Promise<void>;
}

export function subscribeToDealEvents(
  onEvent: (event: DealEvent) => void,
  options: { connectionString?: string; onStatus?: (message: string) => void } = {},
): DealEventSubscription {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  const say = options.onStatus ?? (() => {});

  let client: Client | null = null;
  let closed = false;
  let attempt = 0;
  let timer: NodeJS.Timeout | null = null;

  async function connect(): Promise<void> {
    if (closed) return;

    const next = new Client({ connectionString });
    client = next;

    next.on("notification", (message) => {
      if (message.channel !== DEAL_EVENT_CHANNEL || !message.payload) return;
      const event = decodeDealEvent(message.payload);
      if (event) onEvent(event);
    });

    // A connection-level error is how a dropped listener surfaces.
    next.on("error", (error) => {
      say(`listener error: ${error.message}`);
      void reconnect();
    });

    try {
      await next.connect();
      await next.query(`LISTEN ${DEAL_EVENT_CHANNEL}`);
      attempt = 0;
      say(`listening on ${DEAL_EVENT_CHANNEL}`);
    } catch (error) {
      say(`listener could not connect: ${(error as Error).message}`);
      void reconnect();
    }
  }

  async function reconnect(): Promise<void> {
    if (closed || timer) return;

    const previous = client;
    client = null;
    // End the dead connection without letting its own error re-enter here.
    previous?.removeAllListeners();
    await previous?.end().catch(() => {});

    // 0.5s, 1s, 2s, 4s, capped at 10s.
    const delay = Math.min(500 * 2 ** attempt, 10_000);
    attempt += 1;
    say(`reconnecting in ${delay}ms`);

    timer = setTimeout(() => {
      timer = null;
      void connect();
    }, delay);
  }

  void connect();

  return {
    close: async () => {
      closed = true;
      if (timer) clearTimeout(timer);
      const previous = client;
      client = null;
      previous?.removeAllListeners();
      await previous?.end().catch(() => {});
    },
  };
}
