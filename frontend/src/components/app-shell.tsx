"use client";

import { useShellStatus } from "@/lib/use-shell-status";

/**
 * The window shell every screen sits in.
 *
 * The seven screens were designed independently and each invented its own
 * frame: window widths ran from 1440 to 1580, the scroll region cleared the
 * dock with pb-24 on some screens and pb-28 on others, the status bar was h-7,
 * h-8, h-9, pinned outside the window, or missing entirely - and the command
 * centre had no frame at all, so the whole document scrolled behind a floating
 * dock. Navigating between them made the chrome jump.
 *
 * Subscription & Billing had the right shape, so it is the model, and it is
 * encoded here once rather than restated seven times:
 *
 *   AppShell        the page: full viewport height, never scrolls itself
 *     AppWindow     the white card: fills the shell, clips its own content
 *       (header)    any number of shrink-0 strips - chrome, title, KPIs
 *       WindowScroll  EXACTLY ONE scrolling region
 *       StatusBar   the footer, pinned to the bottom of the card
 *     dock          fixed to the viewport, via DOCK_POSITION
 *     agent         fixed to the viewport, via AGENT_POSITION
 *
 * The `min-h-0` on the shell and window is what actually makes this work. A
 * flex child defaults to `min-height: auto`, which refuses to shrink below its
 * content - so without it a long page pushes the footer off screen instead of
 * scrolling inside WindowScroll, which is the bug several of these screens had.
 */

/** One width for every screen, so the frame does not resize between pages. */
const WINDOW_WIDTH = "max-w-[1536px]";

/** Both are fixed to the viewport, not to the window, so they never scroll. */
export const DOCK_POSITION = "fixed bottom-3 left-1/2 -translate-x-1/2 z-50";
export const AGENT_POSITION = "fixed bottom-3 right-5 z-50";

export function AppShell({
  className = "",
  children,
}: {
  /** The screen's own scoping class, font and page background. */
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        "h-screen w-full p-2.5 md:p-3.5 flex flex-col overflow-hidden antialiased " + className
      }
    >
      {children}
    </div>
  );
}

export function AppWindow({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <main
      className={
        "w-full mx-auto bg-white rounded-2xl shadow-xl border border-slate-200/80 flex flex-col flex-1 min-h-0 overflow-hidden relative " +
        WINDOW_WIDTH +
        " " +
        className
      }
    >
      {children}
    </main>
  );
}

export function WindowScroll({
  className = "",
  children,
}: {
  /** Per-screen padding and background; the scroll behaviour is fixed. */
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={"flex-1 min-h-0 overflow-y-auto app-scroll pb-28 " + className}>{children}</div>
  );
}

/**
 * The status bar, rendered identically on all seven screens.
 *
 * It takes no props on purpose. Every previous attempt to keep "just one
 * per-screen bit" here is what let the seven footers drift apart in the first
 * place - a differently-coloured detail span, an extra "Session: TLS 1.3
 * Encrypted" block, a version number in three different greys. There is nothing
 * to decide per screen, so there is nothing to pass.
 */
/** The symbol for the codes this deployment can actually be set to. */
const CURRENCY_SYMBOL: Record<string, string> = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
};

export function StatusBar() {
  /**
   * These used to be three literals in the markup, and two of them were lies.
   *
   * "Currency: INR (₹)" stayed rupees however the currency setting was changed,
   * and "Sync: Live (0.2s)" claimed a live connection whether or not the socket
   * was up - including when the realtime hub was not running at all. A status
   * bar that reports a fixed string is worse than one that reports nothing,
   * because people read it and believe it.
   */
  const { currencyCode, connected } = useShellStatus();
  const symbol = currencyCode ? (CURRENCY_SYMBOL[currencyCode] ?? currencyCode) : null;

  return (
    <footer className="h-8 shrink-0 border-t border-slate-200/80 px-4 bg-slate-50 flex items-center justify-between text-[11px] text-slate-500 select-none z-10">
      <div className="flex items-center gap-2">
        <span
          className={
            "w-1.5 h-1.5 rounded-full " + (connected ? "bg-emerald-500" : "bg-slate-300")
          }
        />
        <span>Database: Connected</span>
        <span className="text-slate-300">·</span>
        <span>Currency: {currencyCode ? `${currencyCode} (${symbol})` : "—"}</span>
        <span className="text-slate-300">·</span>
        {/* Says what is true. The hub is a separate process, and it is genuinely
            useful to see at a glance that it is not running. */}
        <span className={connected ? "" : "text-slate-400"}>
          {connected ? "Sync: Live" : "Sync: Offline"}
        </span>
      </div>
      <span className="font-jetbrains text-slate-600">DealFlow360 v4.2.8 Enterprise</span>
    </footer>
  );
}

/**
 * The assistant launcher, bottom-right on every screen.
 *
 * Billing's is the reference: a 44px slate-900 disc with the speech-bubble
 * glyph and an emerald presence dot ringed in the button's own colour. The
 * others had drifted - approvals was 48px, the portal drew a `smart_toy`
 * Material Symbol, fulfilment used a filled icon, and the command centre had a
 * white disc with an indigo outline. All of them render this now.
 *
 * `onClick` is optional because only the command centre's launcher does
 * anything - it opens the chat panel. On the other six the button is inert, as
 * it was in the source screens. It is deliberately the ONLY prop: an earlier
 * `active` flag added a focus ring on the command centre, which made that one
 * button look different from the other six.
 */
export function AgentButton({ onClick }: { onClick?: () => void }) {
  return (
    <button
      className={
        AGENT_POSITION +
        " w-11 h-11 rounded-full bg-slate-900 text-white shadow-lg flex items-center justify-center hover:bg-slate-800 transition-all focus:outline-none"
      }
      onClick={onClick}
      title="DealFlow AI Assistant"
      type="button"
    >
      <div className="relative">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
        </svg>
        <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-500 border-2 border-slate-900 rounded-full" />
      </div>
    </button>
  );
}
