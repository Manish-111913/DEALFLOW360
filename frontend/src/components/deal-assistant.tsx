"use client";

import { useEffect, useRef, useState } from "react";
import { NextActionPanel, SimulatorPanel, SummaryPanel } from "./ai-panels";
import { AGENT_POSITION } from "./app-shell";

/**
 * The Deal Assistant (§3).
 *
 * It reuses the floating button every screen already renders, in the same
 * place, at the same size - the button was there and did nothing, and this
 * gives it its purpose without moving a pixel of any screen.
 *
 * The panel opens above the button and is deliberately small: §3 asks for a
 * compact panel rather than a full-screen chatbot, and a sales rep mid-quote
 * should be able to ask a question without losing sight of the quote.
 *
 * Nothing here knows any business facts. It posts the screen name, the open
 * deal id and a question; the server decides what this user may be told.
 */

export interface AssistantMessage {
  role: "user" | "assistant";
  text: string;
}

/** What "this deal" means, per screen. */
export interface AssistantScope {
  screen: string;
  quotationId?: string | null;
  /** Shown in the panel header so it is obvious what is being discussed. */
  subject?: string | null;
}

/**
 * The panel's four modes.
 *
 * They live in one panel rather than as new cards on each screen because the
 * screens are already laid out and this must not disturb them (and because the
 * same four are useful everywhere). Three of them need a deal in view; "Ask"
 * works either way, falling back to the caller's whole pipeline.
 */
type Tab = "ask" | "summary" | "action" | "simulate";

const TABS: [Tab, string, boolean][] = [
  // key, label, requires an open deal
  ["ask", "Ask", false],
  ["summary", "Summary", true],
  ["action", "Next action", true],
  ["simulate", "Simulate", true],
];

const SUGGESTIONS: Record<string, string[]> = {
  dashboard: ["Which deals need me today?", "Where is my revenue at risk?"],
  sales: ["Why does this quote need approval?", "What should I upsell?"],
  approvals: ["Why am I seeing this approval?", "What would clear it?"],
  fulfillment: ["Show me the fulfilment risk.", "Why is this split across warehouses?"],
  billing: ["Explain the recurring billing.", "What changed after the quantity update?"],
  negotiation: ["Give me a recommended negotiation response.", "What is the customer really asking for?"],
  "deal-health": ["Why is this deal at risk?", "What should I do next?"],
};

export function DealAssistant({ screen, quotationId = null, subject = null }: AssistantScope) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("ask");
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the newest answer in view. Reading the scroll position of a DOM node
  // is exactly what an effect is for, so this one is not state synchronisation.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Escape closes, which is what a floating panel should do.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    const asked: AssistantMessage = { role: "user", text: trimmed };
    // The history sent is what was on screen before this question, so the
    // server sees the same conversation the user does.
    const history = messages.slice(-6);

    setMessages((current) => [...current, asked]);
    setQuestion("");
    setBusy(true);
    setProblem(null);

    try {
      const response = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ screen, quotationId, question: trimmed, history }),
      });
      const body = (await response.json().catch(() => null)) as
        | { answer?: string; error?: string }
        | null;

      if (!response.ok || !body?.answer) {
        // The server's message is the one to show: it distinguishes "not
        // configured" from "rate limited" from "not enough context".
        setProblem(body?.error ?? "Deal Intelligence is temporarily unavailable.");
        return;
      }
      setMessages((current) => [...current, { role: "assistant", text: body.answer! }]);
    } catch {
      setProblem("Deal Intelligence is temporarily unavailable.");
    } finally {
      setBusy(false);
    }
  }

  const suggestions = SUGGESTIONS[screen] ?? SUGGESTIONS.dashboard;

  return (
    <>
      {open && (
        <div
          aria-label="Deal Assistant"
          className="fixed bottom-[4.5rem] right-5 z-50 w-[min(24rem,calc(100vw-2.5rem))] max-h-[min(32rem,calc(100vh-8rem))] bg-white rounded-2xl border border-slate-200/90 shadow-2xl flex flex-col overflow-hidden"
          role="dialog"
        >
          <header className="shrink-0 px-4 py-3 border-b border-slate-200/80 bg-slate-50/70 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-900 tracking-tight">Deal Assistant</h2>
              <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                {subject
                  ? `Discussing ${subject}`
                  : "Understand your deals, risks, approvals and next actions."}
              </p>
            </div>
            <button
              aria-label="Close Deal Assistant"
              className="shrink-0 text-slate-400 hover:text-slate-600 p-0.5"
              onClick={() => setOpen(false)}
              type="button"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
              </svg>
            </button>
          </header>

          <nav
            aria-label="Deal Assistant sections"
            className="shrink-0 flex items-center gap-1 px-2.5 py-2 border-b border-slate-200/80 bg-white"
          >
            {TABS.map(([key, label, needsDeal]) => {
              const disabled = needsDeal && !quotationId;
              return (
                <button
                  className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                    tab === key
                      ? "bg-slate-900 text-white"
                      : disabled
                        ? "text-slate-300 cursor-not-allowed"
                        : "text-slate-600 hover:bg-slate-100"
                  }`}
                  disabled={disabled}
                  key={key}
                  onClick={() => setTab(key)}
                  title={disabled ? "Open a deal to use this" : undefined}
                  type="button"
                >
                  {label}
                </button>
              );
            })}
          </nav>

          {tab !== "ask" && (
            <div className="flex-1 min-h-0 overflow-y-auto app-scroll px-4 py-3">
              {tab === "summary" && <SummaryPanel quotationId={quotationId} />}
              {tab === "action" && <NextActionPanel quotationId={quotationId} />}
              {tab === "simulate" && <SimulatorPanel quotationId={quotationId} />}
            </div>
          )}

          {tab === "ask" && (
          <div className="flex-1 min-h-0 overflow-y-auto app-scroll px-4 py-3 space-y-3" ref={scrollRef}>
            {messages.length === 0 && !busy && (
              <div className="space-y-2">
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Ask about this screen. Answers come from your live deal data, and are limited to
                  what your role can see.
                </p>
                {suggestions.map((suggestion) => (
                  <button
                    className="w-full text-left text-xs px-3 py-2 rounded-lg border border-slate-200 bg-slate-50/60 hover:bg-white hover:border-slate-300 text-slate-700 transition-colors"
                    key={suggestion}
                    onClick={() => ask(suggestion)}
                    type="button"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}

            {messages.map((message, index) => (
              <div
                className={message.role === "user" ? "flex justify-end" : "flex justify-start"}
                key={`${message.role}-${index}`}
              >
                <div
                  className={
                    message.role === "user"
                      ? "max-w-[85%] rounded-xl rounded-br-sm bg-indigo-600 text-white px-3 py-2 text-xs leading-relaxed"
                      : "max-w-[92%] rounded-xl rounded-bl-sm bg-slate-50 border border-slate-200/80 text-slate-800 px-3 py-2 text-xs leading-relaxed"
                  }
                >
                  <AssistantText role={message.role} text={message.text} />
                </div>
              </div>
            ))}

            {busy && (
              <div className="flex justify-start">
                <div className="rounded-xl rounded-bl-sm bg-slate-50 border border-slate-200/80 px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    {[0, 150, 300].map((delay) => (
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse"
                        key={delay}
                        style={{ animationDelay: `${delay}ms` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {problem && (
              <p
                className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-relaxed"
                role="alert"
              >
                {problem}
              </p>
            )}
          </div>

          )}

          {tab === "ask" && (
          <form
            className="shrink-0 border-t border-slate-200/80 p-2.5 flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void ask(question);
            }}
          >
            <input
              className="flex-1 min-w-0 text-xs px-3 py-2 border border-slate-200 rounded-lg bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition-all placeholder:text-slate-400"
              disabled={busy}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask about this deal…"
              ref={inputRef}
              value={question}
            />
            <button
              aria-label="Send"
              className="shrink-0 w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center hover:bg-indigo-700 transition-colors disabled:opacity-50"
              disabled={busy || !question.trim()}
              type="submit"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M14 5l7 7m0 0l-7 7m7-7H3" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
              </svg>
            </button>
          </form>
          )}

          {tab === "ask" && (
            <p className="shrink-0 px-3 pb-2.5 text-[10px] text-slate-400 leading-snug">
              AI assistance based on your live deal data. Business rules remain authoritative.
            </p>
          )}
        </div>
      )}

      {/* The same button, in the same place, that every screen already had. */}
      <button
        aria-expanded={open}
        className={
          AGENT_POSITION +
          " w-11 h-11 rounded-full bg-slate-900 text-white shadow-lg flex items-center justify-center hover:bg-slate-800 transition-all focus:outline-none"
        }
        onClick={() => setOpen((current) => !current)}
        title="Deal Assistant"
        type="button"
      >
        <div className="relative">
          {open ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
            </svg>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                />
              </svg>
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-500 border-2 border-slate-900 rounded-full" />
            </>
          )}
        </div>
      </button>
    </>
  );
}

/**
 * Render an answer.
 *
 * The model is asked for short paragraphs and bullets, and returns `**bold**`
 * labels and `*` bullets. This handles exactly those two, rather than pulling
 * in a markdown renderer for a 150-word answer - and because it handles only
 * those two, there is no path by which model output becomes markup.
 */
function AssistantText({ text, role }: { text: string; role: "user" | "assistant" }) {
  if (role === "user") return <>{text}</>;

  return (
    <div className="space-y-1.5">
      {text.split("\n").map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return null;

        const bullet = /^[-*•]\s+/.test(trimmed);
        const content = bullet ? trimmed.replace(/^[-*•]\s+/, "") : trimmed;

        return (
          <p className={bullet ? "flex gap-1.5" : ""} key={index}>
            {bullet && <span className="text-slate-400 shrink-0">•</span>}
            <span>{renderBold(content)}</span>
          </p>
        );
      })}
    </div>
  );
}

/** `**like this**` becomes bold. Everything else stays literal text. */
function renderBold(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong className="font-semibold text-slate-900" key={index}>
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}
