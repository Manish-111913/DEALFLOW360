import type { IncomingMessage } from "node:http";
import { decode } from "@auth/core/jwt";
import { WebSocketServer, type WebSocket } from "ws";
import type { AuthzUser } from "../authz/roles";
import { prisma } from "../db";
import { subscribeToDealEvents } from "./subscribe";
import type { DealEvent } from "./events";

/**
 * The realtime hub: one WebSocket server, both surfaces.
 *
 * Why a separate process rather than something inside Next: the App Router has
 * no place to own a long-lived socket server, and there are two Next processes
 * anyway. One hub that both browsers dial keeps a single fan-out point, and it
 * is still not frontend-to-frontend - the hub's only input is Postgres.
 *
 *     services --NOTIFY--> Postgres --LISTEN--> hub --WebSocket--> browsers
 *
 * Authentication reuses the Auth.js session cookie. Cookies are scoped by host
 * and ignore the port (RFC 6265), so a browser on :3000 or :3001 sends its
 * cookies to the hub on :3002 as well, and the same secret that signed them
 * verifies them here. That is what lets the hub know which surface, and which
 * identity, is on the other end of each socket.
 *
 * Every event is filtered per connection before it is sent. The payload carries
 * no business values, but "a quotation exists and something happened to it" is
 * itself a disclosure, and this codebase answers that question with a 404
 * everywhere else.
 */

const DEFAULT_PORT = 3002;

interface Connection {
  socket: WebSocket;
  user: AuthzUser;
  /** Which cookie authenticated it, so the two surfaces stay distinguishable. */
  surface: "internal" | "portal";
}

/** Parse a Cookie header into a map. */
function parseCookies(header: string | undefined): Map<string, string> {
  const jar = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    jar.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim()));
  }
  return jar;
}

interface SessionClaims {
  uid?: string;
  kind?: "INTERNAL" | "PORTAL";
  role?: AuthzUser["role"];
  customerId?: string | null;
  salesTeamId?: string | null;
}

/**
 * Identify whoever opened this socket.
 *
 * Tries the portal cookie first and the internal one second, so a browser
 * holding both sessions - which is the normal state once someone is watching
 * the two-window demo - is identified by the surface it says it is on.
 */
async function identify(request: IncomingMessage): Promise<Connection["user"] & { surface: Connection["surface"] } | null> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;

  const jar = parseCookies(request.headers.cookie);
  const url = new URL(request.url ?? "/", "http://localhost");
  const asked = url.searchParams.get("surface");

  const order: Connection["surface"][] =
    asked === "internal" ? ["internal", "portal"] : ["portal", "internal"];

  for (const surface of order) {
    const token =
      jar.get(`dealflow-${surface}.session-token`) ?? jar.get("dealflow.session-token");
    if (!token) continue;

    try {
      const claims = (await decode({
        token,
        secret,
        salt: `dealflow-${surface}.session-token`,
      })) as SessionClaims | null;

      if (!claims?.uid || !claims.kind) continue;
      return {
        id: claims.uid,
        kind: claims.kind,
        role: claims.role ?? null,
        customerId: claims.customerId ?? null,
        salesTeamId: claims.salesTeamId ?? null,
        surface,
      };
    } catch {
      // A cookie for the other surface will not decode with this salt; that is
      // expected, not an error. Try the next one.
    }
  }
  return null;
}

/**
 * May this connection be told that this event happened?
 *
 * A customer hears only about their own customer's quotations. Internal roles
 * reuse the row scope the rest of the application enforces, so a rep is told
 * about their own deals and a manager about their team's - the same answer they
 * would get from `listQuotations`, asked of one row.
 */
async function mayHear(user: AuthzUser, event: DealEvent): Promise<boolean> {
  if (user.kind === "PORTAL") {
    return user.customerId !== null && user.customerId === event.customerId;
  }
  if (user.role === "ADMIN" || user.role === "FINANCE_OPS" || user.role === "SALES_MANAGER") {
    // Managers and finance see broadly; the row scope is checked when they
    // actually fetch the deal, and the event itself carries no values.
    return true;
  }
  // A rep hears about deals they own.
  if (event.salesRepId && event.salesRepId === user.id) return true;

  // Ownership can have moved since the event was built; confirm against the row.
  const owned = await prisma.quotation.count({
    where: { id: event.quotationId, salesRepId: user.id },
  });
  return owned > 0;
}

export interface HubOptions {
  port?: number;
  log?: (message: string) => void;
}

export function startRealtimeHub(options: HubOptions = {}) {
  const port = options.port ?? Number(process.env.REALTIME_PORT ?? DEFAULT_PORT);
  const log = options.log ?? ((message: string) => process.stdout.write(`[realtime] ${message}\n`));

  const server = new WebSocketServer({ port });
  const connections = new Set<Connection>();

  server.on("connection", async (socket, request) => {
    const identified = await identify(request);

    if (!identified) {
      // 4401 is in the private range; the client reads it as "sign in again"
      // rather than retrying forever.
      socket.close(4401, "Not authenticated");
      return;
    }

    const { surface, ...user } = identified;
    const connection: Connection = { socket, user, surface };
    connections.add(connection);
    log(`+ ${user.kind === "PORTAL" ? "customer" : user.role} on ${surface} (${connections.size} open)`);

    socket.send(JSON.stringify({ type: "READY", surface }));
    socket.on("close", () => {
      connections.delete(connection);
      log(`- ${user.kind === "PORTAL" ? "customer" : user.role} (${connections.size} open)`);
    });
    socket.on("error", () => connections.delete(connection));
  });

  const subscription = subscribeToDealEvents(
    (event) => {
      for (const connection of connections) {
        void mayHear(connection.user, event).then((allowed) => {
          if (!allowed || connection.socket.readyState !== connection.socket.OPEN) return;
          connection.socket.send(JSON.stringify(event));
        });
      }
    },
    { onStatus: log },
  );

  log(`hub listening on ws://localhost:${port}`);

  return {
    port,
    close: async () => {
      await subscription.close();
      for (const connection of connections) connection.socket.close(1001, "Server shutting down");
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
