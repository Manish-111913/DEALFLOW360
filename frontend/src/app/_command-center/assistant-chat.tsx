"use client";

import { useEffect, useRef, useState } from "react";
import { AgentButton } from "@/components/app-shell";
import { useToast } from "@/components/toast";

/**
 * The DealFlow Assistant popup and its launcher button.
 *
 * The original appended message bubbles with innerHTML and scrolled the
 * container by hand. Here the conversation is a piece of state and the bubbles
 * are rendered from it, which removes the innerHTML - user text went straight
 * into markup there, so a message containing < or & would have broken the
 * layout. The canned opening exchange is seeded into the markup so the popup
 * still opens looking exactly as it did.
 *
 * The panel starts closed. The source screen opened it on load, which meant
 * the home page appeared with a third of the dashboard already covered.
 */

interface Message {
  from: "assistant" | "user";
  text: string;
}

const SUGGESTIONS = [
  { chip: "Show deals needing attention", asks: "Which deals need my attention?" },
  { chip: "Check pending approvals", asks: "Check pending approvals" },
  { chip: "Show fulfillment issues", asks: "Show fulfillment issues" },
  { chip: "View today's deadlines", asks: "View today's deadlines" },
];

export function AssistantChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Escape closes the popup, matching the original global keydown handler.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages]);

  /** Adds the question, then the canned reply after the original 600ms beat. */
  function ask(question: string, reply: string) {
    setMessages((current) => [...current, { from: "user", text: question }]);
    setTimeout(() => {
      setMessages((current) => [...current, { from: "assistant", text: reply }]);
    }, 600);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const query = draft.trim();
    if (!query) return;
    setDraft("");
    ask(
      query,
      'Analyzing operations for "' +
        query +
        '"... Your pipeline indicators look healthy. Let me know if you want to generate a summary report.',
    );
  }

  function askSuggestion(chip: string) {
    ask(
      chip,
      "I've pulled the latest updates for: \"" +
        chip +
        '". All related queue items and approval workflows are synced.',
    );
  }

  return (
    <>
      {open && (
        <ChatPanel
          messages={messages}
          draft={draft}
          onDraftChange={setDraft}
          onSubmit={submit}
          onSuggestion={askSuggestion}
          onClose={() => setOpen(false)}
          scrollRef={scrollRef}
        />
      )}

      {/* The launcher is the shared agent button; on this screen alone it
          opens the chat panel rather than sitting inert. */}
      <AgentButton onClick={() => setOpen((current) => !current)} />
    </>
  );
}

function ChatPanel({
  messages,
  draft,
  onDraftChange,
  onSubmit,
  onSuggestion,
  onClose,
  scrollRef,
}: {
  messages: Message[];
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  onSuggestion: (chip: string) => void;
  onClose: () => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const showToast = useToast();

  return (
    <div
      className="fixed bottom-[68px] right-5 z-50 w-[380px] h-[520px] bg-white rounded-2xl border border-slate-200 shadow-2xl shadow-slate-900/15 flex flex-col overflow-hidden transition-all duration-200 origin-bottom-right"
      id="dealflow-chat-popup"
    >
      {/* Header */}
      <div className="p-3.5 px-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-sm">
            <svg
              className="w-4 h-4 text-white"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
          </div>
          <div>
            <h3 className="font-display font-semibold text-sm leading-tight text-white">
              DealFlow Assistant
            </h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-[11px] text-slate-300 font-medium">Online</span>
            </div>
          </div>
        </div>
        <button
          aria-label="Close Assistant"
          className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          onClick={onClose}
          type="button"
        >
          <span className="text-base font-bold leading-none">✕</span>
        </button>
      </div>

      {/* Scrollable Content Area */}
      <div
        ref={scrollRef}
        className="flex-1 p-4 overflow-y-auto space-y-4 chat-scroll bg-slate-50/50"
      >
        {/* Assistant Initial Greeting */}
        <div className="flex items-start gap-2.5">
          <Avatar />
          <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm p-3 text-xs text-slate-800 shadow-2xs leading-relaxed max-w-[85%]">
            Hi Priya. How can I help with your sales operations today?
          </div>
        </div>

        {/* Compact Suggestion Chips */}
        <div className="flex flex-wrap gap-1.5 pl-8">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion.chip}
              className="suggestion-chip px-2.5 py-1 text-[11px] font-medium bg-white hover:bg-indigo-50/80 text-indigo-700 hover:text-indigo-800 border border-slate-200/90 hover:border-indigo-200 rounded-full shadow-2xs transition-all text-left"
              onClick={() => onSuggestion(suggestion.asks)}
              type="button"
            >
              {suggestion.chip}
            </button>
          ))}
        </div>

        {/* The canned exchange the screen opens with */}
        <div className="flex justify-end">
          <div className="bg-indigo-600 text-white rounded-2xl rounded-tr-sm p-2.5 px-3.5 text-xs shadow-sm max-w-[80%] leading-relaxed font-medium">
            Which deals need my attention?
          </div>
        </div>

        <div className="flex items-start gap-2.5">
          <Avatar />
          <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm p-3 text-xs text-slate-800 shadow-2xs space-y-2.5 max-w-[88%]">
            <p className="leading-relaxed">
              You have <strong>4 quotations awaiting approval</strong>,{" "}
              <strong>3 stalled deals</strong>, and <strong>2 fulfillment backorders</strong>.
            </p>
            <div className="space-y-1.5 pt-1 border-t border-slate-100">
              <SummaryRow
                tone="amber"
                label="4 Pending Approvals"
                action="Review →"
                onClick={() => showToast("Opening Approvals queue")}
              />
              <SummaryRow
                tone="rose"
                label="3 Stalled Deals"
                action="Review →"
                onClick={() => showToast("Opening Stalled Deals review list")}
              />
              <SummaryRow
                tone="blue"
                label="2 Backorders"
                action="Inspect →"
                onClick={() => showToast("Opening Depot Fulfillment queue")}
              />
            </div>
          </div>
        </div>

        {/* Anything said since the page loaded */}
        {messages.map((message, index) =>
          message.from === "user" ? (
            <div key={index} className="flex justify-end">
              <div className="bg-indigo-600 text-white rounded-2xl rounded-tr-sm p-2.5 px-3.5 text-xs shadow-sm max-w-[80%] leading-relaxed font-medium">
                {message.text}
              </div>
            </div>
          ) : (
            <div key={index} className="flex items-start gap-2.5">
              <Avatar />
              <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm p-3 text-xs text-slate-800 shadow-2xs leading-relaxed max-w-[88%]">
                {message.text}
              </div>
            </div>
          ),
        )}
      </div>

      {/* Bottom Input Area */}
      <div className="p-3 bg-white border-t border-slate-200 shrink-0">
        <form className="flex items-center gap-2" onSubmit={onSubmit}>
          <input
            className="flex-1 bg-slate-50 border border-slate-200 text-slate-800 text-xs rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-1.5 focus:ring-indigo-500 focus:bg-white placeholder:text-slate-400"
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder="Ask about your deals..."
            type="text"
            value={draft}
          />
          <button
            aria-label="Send Message"
            className="w-9 h-9 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center shrink-0 shadow-sm transition-colors cursor-pointer"
            type="submit"
          >
            <svg
              className="w-4 h-4 translate-x-0.5"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <line x1="22" x2="11" y1="2" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}

function Avatar() {
  return (
    <div className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0 mt-0.5 text-[10px] font-bold">
      DF
    </div>
  );
}

const SUMMARY_TONES = {
  amber: {
    row: "bg-amber-50/50 hover:bg-amber-50 border-amber-100",
    text: "text-amber-800",
    dot: "bg-amber-500",
  },
  rose: {
    row: "bg-rose-50/50 hover:bg-rose-50 border-rose-100",
    text: "text-rose-800",
    dot: "bg-rose-500",
  },
  blue: {
    row: "bg-blue-50/50 hover:bg-blue-50 border-blue-100",
    text: "text-blue-800",
    dot: "bg-blue-600",
  },
} as const;

function SummaryRow({
  tone,
  label,
  action,
  onClick,
}: {
  tone: keyof typeof SUMMARY_TONES;
  label: string;
  action: string;
  onClick: () => void;
}) {
  const styles = SUMMARY_TONES[tone];
  return (
    <div
      className={
        "flex items-center justify-between p-1.5 border rounded-lg text-[11px] transition-colors " +
        styles.row
      }
    >
      <div className={"flex items-center gap-1.5 font-medium " + styles.text}>
        <span className={"w-1.5 h-1.5 rounded-full " + styles.dot} />
        <span>{label}</span>
      </div>
      <button
        className="text-indigo-600 hover:text-indigo-800 font-semibold text-[11px] cursor-pointer"
        onClick={onClick}
        type="button"
      >
        {action}
      </button>
    </div>
  );
}
