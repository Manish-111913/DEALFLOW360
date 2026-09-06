import { startRealtimeHub } from "./src/realtime/hub";

/**
 * The realtime hub as a standalone process.
 *
 *   npm run realtime          (from backend/)
 *
 * It holds no state of its own: it listens to Postgres and fans events out to
 * whichever browsers are attached. Stopping it costs live updates and nothing
 * else - both surfaces re-read authoritative state after every mutation, so the
 * application stays correct without it.
 */
const hub = startRealtimeHub();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void hub.close().then(() => process.exit(0));
  });
}
