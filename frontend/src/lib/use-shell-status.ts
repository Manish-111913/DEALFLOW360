"use client";

import { useEffect, useState } from "react";
import { useDealEvents } from "./use-deal-events";

/**
 * The live numbers the dock and the status bar show.
 *
 * Fetched once per mount and then re-fetched whenever the realtime hub says a
 * deal moved - which is what makes the Approvals badge fall to three the moment
 * someone approves something, rather than at the next full navigation. The
 * socket already exists for the screens that use it; this rides the same one.
 *
 * `connected` is passed through so the status bar can say whether "Sync: Live"
 * is actually true. Claiming a live connection while the socket is down is the
 * kind of small lie that makes someone stop trusting the rest of the screen.
 *
 * The fetch is written as an async IIFE inside the effect, with the state write
 * after the await and behind a `cancelled` guard - the same shape
 * `useAiResource` uses, and the shape React's set-state-in-effect rule wants.
 */

export interface ShellStatus {
  pendingApprovals: number | null;
  currencyCode: string | null;
  connected: boolean;
}

interface ShellPayload {
  pendingApprovals: number;
  currencyCode: string;
}

export function useShellStatus(): ShellStatus {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<ShellPayload | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/shell", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as ShellPayload;
        if (!cancelled) setStatus(body);
      } catch {
        // The chrome is not worth an error state. It renders its static half
        // and simply omits the numbers it could not fetch - which is also what
        // happens on the sign-in page, where there is no session to count for.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // Any deal event can change the queue depth - a submission adds to it, a
  // decision removes from it - so the cheapest correct rule is to re-read on
  // all of them. Bumping a counter rather than calling the fetch directly keeps
  // the one place that writes state inside the effect above.
  const { connected } = useDealEvents({
    surface: "internal",
    onEvent: () => setAttempt((n) => n + 1),
  });

  return {
    pendingApprovals: status?.pendingApprovals ?? null,
    currencyCode: status?.currencyCode ?? null,
    connected,
  };
}
