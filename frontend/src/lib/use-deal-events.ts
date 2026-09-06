"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Live deal events, over the realtime hub's WebSocket.
 *
 * The hub is a separate process that listens to Postgres and fans events out;
 * this is only the browser end of it. Two things it deliberately does not do:
 *
 *  - It never carries business values. An event says "this quotation changed",
 *    and the caller re-reads through its own authorised endpoint. A socket is
 *    not an authorisation boundary anyone should be relying on.
 *  - It is never required. Every mutation already re-reads authoritative state,
 *    so with the hub stopped the application is still correct - it just stops
 *    updating a window nobody is touching. `connected` is exposed so a screen
 *    can say which of those it is showing.
 */

export type DealEventType =
  | "QUOTE_UPDATED"
  | "NEGOTIATION_SUBMITTED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_COMPLETED"
  | "QUOTE_CONFIRMED";

export interface DealEvent {
  type: DealEventType;
  quotationId: string;
  customerId: string;
  salesRepId: string | null;
  at: number;
}

function hubUrl(surface: "internal" | "portal"): string {
  const base = process.env.NEXT_PUBLIC_REALTIME_URL ?? "ws://localhost:3002";
  return `${base}?surface=${surface}`;
}

export interface UseDealEventsOptions {
  surface: "internal" | "portal";
  /** Ignore events about other deals. Omit to hear about all of them. */
  quotationId?: string | null;
  onEvent: (event: DealEvent) => void;
}

export function useDealEvents({
  surface,
  quotationId = null,
  onEvent,
}: UseDealEventsOptions): { connected: boolean } {
  const [connected, setConnected] = useState(false);

  // Held in refs so a parent re-rendering with a new closure does not tear the
  // socket down and rebuild it.
  //
  // Refreshed in an effect rather than during render: a ref write is a side
  // effect, and React needs render to stay pure - a render that is thrown away
  // and retried must not have already changed something.
  const handler = useRef(onEvent);
  const filter = useRef(quotationId);

  useEffect(() => {
    handler.current = onEvent;
    filter.current = quotationId;
  });

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let closed = false;

    const open = () => {
      if (closed) return;

      socket = new WebSocket(hubUrl(surface));

      socket.onopen = () => {
        attempt = 0;
        setConnected(true);
      };

      socket.onmessage = (message) => {
        try {
          const payload = JSON.parse(message.data as string) as DealEvent | { type: "READY" };
          if (payload.type === "READY") return;

          const event = payload as DealEvent;
          if (filter.current && event.quotationId !== filter.current) return;
          handler.current(event);
        } catch {
          // A frame we cannot parse is not worth tearing the socket down for.
        }
      };

      socket.onclose = (closeEvent) => {
        setConnected(false);
        // 4401 means the hub did not recognise the session. Retrying cannot fix
        // that, and hammering it would only spin.
        if (closed || closeEvent.code === 4401) return;

        const delay = Math.min(1000 * 2 ** attempt, 15_000);
        attempt += 1;
        retry = setTimeout(open, delay);
      };

      socket.onerror = () => {
        // onclose always follows, and that is where reconnection is handled.
        socket?.close();
      };
    };

    open();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, [surface]);

  return { connected };
}
