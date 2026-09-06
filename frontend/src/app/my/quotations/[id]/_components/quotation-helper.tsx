"use client";

import { useState, useTransition } from "react";

/**
 * The customer's own AI helper.
 *
 * Two things, and deliberately only two: explain what this quotation says, and
 * help write what you want to ask for. Both are built on the customer's own
 * portal view of their own quotation, through a separate backend context builder
 * that cannot reach margin, cost, risk or approval state even by accident (D20).
 *
 * What it does NOT do is act. The drafting half produces text and drops it into
 * the negotiation form the customer was already going to use - they read it,
 * edit it, and press their own button. A model that could open a negotiation on
 * someone's behalf would be putting words in their mouth on a commercial record,
 * and the fact that the words are usually good does not make that acceptable.
 */

interface Explanation {
  whatYouAreBuying: string;
  whatTheTotalCovers: string;
  discountAndTax: string;
  whatHappensNext: string;
  whatIsAskedOfYou: string;
}

interface Draft {
  requestType: string;
  lineId: string | null;
  requestedValue: string | null;
  message: string;
}

const EXPLANATION_SECTIONS: [keyof Explanation, string][] = [
  ["whatYouAreBuying", "What you're buying"],
  ["whatTheTotalCovers", "What the total covers"],
  ["discountAndTax", "Discount and tax"],
  ["whatHappensNext", "What happens next"],
  ["whatIsAskedOfYou", "What we need from you"],
];

const REQUEST_LABEL: Record<string, string> = {
  COUNTER_DISCOUNT: "a better price",
  QUANTITY_CHANGE: "a quantity change",
  QUESTION: "a question",
  OTHER: "a request",
};

export function QuotationHelper({
  quotationId,
  canNegotiate,
  onUseDraft,
}: {
  quotationId: string;
  /** A confirmed quotation has nothing left to negotiate, so the drafter hides. */
  canNegotiate: boolean;
  /** Hands the finished text back to the negotiation form the customer edits. */
  onUseDraft: (message: string) => void;
}) {
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [intent, setIntent] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  function explain() {
    startTransition(async () => {
      const response = await fetch(`/api/portal/ai/explain/${quotationId}`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setProblem(body.error ?? "That could not be explained right now.");
        return;
      }
      setProblem(null);
      setExplanation(body.explanation as Explanation);
    });
  }

  function write() {
    if (!intent.trim()) {
      setProblem("Tell us what you'd like to ask for.");
      return;
    }
    startTransition(async () => {
      const response = await fetch(`/api/portal/ai/draft/${quotationId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setProblem(body.error ?? "That could not be drafted right now.");
        return;
      }
      setProblem(null);
      setDraft(body.draft as Draft);
    });
  }

  return (
    <section className="bg-white border border-slate-200/90 rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3 pb-3 mb-3 border-b border-slate-100">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Need a hand with this?</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            We can put this quotation in plain language, or help you word a request.
          </p>
        </div>
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-slate-400 border border-slate-200 rounded px-1.5 py-0.5">
          Assistant
        </span>
      </div>

      {/* --- Explain ------------------------------------------------------ */}
      {explanation ? (
        <div className="space-y-3">
          {EXPLANATION_SECTIONS.map(([key, label]) => (
            <div key={key}>
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">
                {label}
              </h3>
              <p className="text-xs text-slate-700 leading-relaxed">{explanation[key]}</p>
            </div>
          ))}
        </div>
      ) : (
        <button
          className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors disabled:opacity-60"
          disabled={busy}
          onClick={explain}
          type="button"
        >
          {busy ? "Reading it…" : "Explain this quotation"}
        </button>
      )}

      {/* --- Draft a request ---------------------------------------------- */}
      {canNegotiate && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <label
            className="block text-[11px] font-semibold text-slate-700 mb-1"
            htmlFor="helper-intent"
          >
            Want to ask for something?
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              className="flex-1 text-xs rounded-lg border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/20 py-2 px-3"
              id="helper-intent"
              maxLength={500}
              onChange={(event) => {
                setIntent(event.target.value);
                setProblem(null);
              }}
              placeholder="e.g. the laptops are over budget, can we do better?"
              type="text"
              value={intent}
            />
            <button
              className="px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs transition-colors disabled:opacity-60 shrink-0"
              disabled={busy}
              onClick={write}
              type="button"
            >
              {busy ? "Writing…" : "Draft it for me"}
            </button>
          </div>

          {draft && (
            <div className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <p className="text-[11px] text-slate-500">
                A draft asking for{" "}
                <strong className="text-slate-700">
                  {REQUEST_LABEL[draft.requestType] ?? "a change"}
                </strong>
                {draft.requestedValue ? ` of ${draft.requestedValue}` : ""}. Read it over — nothing
                has been sent.
              </p>
              <p className="text-xs text-slate-800 leading-relaxed whitespace-pre-wrap">
                {draft.message}
              </p>
              <button
                className="px-3 py-1.5 text-[11px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors"
                onClick={() => onUseDraft(draft.message)}
                type="button"
              >
                Use this wording →
              </button>
            </div>
          )}
        </div>
      )}

      {problem && <p className="text-[11px] text-rose-600 font-medium mt-3">{problem}</p>}

      <p className="text-[10px] text-slate-400 mt-4 pt-3 border-t border-slate-100 leading-relaxed">
        Written by an assistant from this quotation only. It is a summary for convenience — the
        figures in the table above are the ones that count.
      </p>
    </section>
  );
}
