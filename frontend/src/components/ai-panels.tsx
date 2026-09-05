"use client";

import { useCallback, useEffect, useState } from "react";
import type { ComparedScenario, DealSummary, NextBestAction } from "@dealflow/backend";

/**
 * The three generated cards: Deal Summary (§7), Next Best Action (§4) and the
 * What-if comparison (§5).
 *
 * They share a loading contract, so it lives here once. Each is fetched only
 * when its tab is first opened rather than on page render - partly because a
 * card nobody looked at should not cost a model call, and partly because
 * Gemini's free tier allows twenty of those a day.
 *
 * Type-only imports from the backend package are erased at compile time, so
 * naming the server's shapes here costs the browser bundle nothing and keeps
 * the two sides from drifting.
 */

type LoadState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "failed"; message: string };

/**
 * Fetch once per deal, and re-fetch when the deal changes.
 *
 * "Loading" is derived rather than stored: what is kept is the answer together
 * with the request it answers, and anything whose answer has not arrived yet is
 * by definition still loading. That removes the setState-in-an-effect that a
 * stored flag needs, and it also removes the bug that flag invites - a stale
 * answer briefly showing under a new deal id before the effect resets it.
 */
function useAiResource<T>(url: string | null): {
  state: LoadState<T>;
  reload: () => void;
} {
  const [attempt, setAttempt] = useState(0);
  const [answered, setAnswered] = useState<{
    url: string;
    attempt: number;
    outcome: { status: "ready"; data: T } | { status: "failed"; message: string };
  } | null>(null);

  useEffect(() => {
    if (!url) return;

    let cancelled = false;
    void (async () => {
      const settle = (outcome: { status: "ready"; data: T } | { status: "failed"; message: string }) => {
        if (!cancelled) setAnswered({ url, attempt, outcome });
      };

      try {
        const response = await fetch(url, { cache: "no-store" });
        const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;

        if (!response.ok || !body) {
          // The server distinguishes "not configured" from "rate limited" from
          // "not enough context"; show what it said.
          settle({
            status: "failed",
            message: body?.error ?? "Deal Intelligence is temporarily unavailable.",
          });
          return;
        }
        settle({ status: "ready", data: body as T });
      } catch {
        settle({ status: "failed", message: "Deal Intelligence is temporarily unavailable." });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url, attempt]);

  const state: LoadState<T> = !url
    ? { status: "idle" }
    : answered && answered.url === url && answered.attempt === attempt
      ? answered.outcome
      : { status: "loading" };

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, reload };
}

function Skeleton({ lines = 4 }: { lines?: number }) {
  return (
    <div className="space-y-2 animate-pulse" aria-label="Generating">
      {Array.from({ length: lines }).map((_, index) => (
        <div
          className="h-2.5 rounded bg-slate-100"
          key={index}
          style={{ width: `${88 - index * 9}%` }}
        />
      ))}
    </div>
  );
}

function Failure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
      <p className="text-[11px] text-amber-900 leading-relaxed">{message}</p>
      <button
        className="mt-1.5 text-[11px] font-semibold text-amber-900 underline hover:no-underline"
        onClick={onRetry}
        type="button"
      >
        Try again
      </button>
    </div>
  );
}

function NoDeal({ what }: { what: string }) {
  return (
    <p className="text-[11px] text-slate-500 leading-relaxed">
      Open a deal to generate {what}. On this screen there is no single deal in view.
    </p>
  );
}

// ---------------------------------------------------------------------------
// §7 AI Deal Summary
// ---------------------------------------------------------------------------

const SUMMARY_SECTIONS: [keyof DealSummary, string][] = [
  ["overview", "Overview"],
  ["commercialPosition", "Commercial position"],
  ["risk", "Risk"],
  ["customerPosition", "Customer position"],
  ["fulfillment", "Fulfilment"],
  ["billing", "Billing"],
  ["recommendedAction", "Recommended action"],
];

export function SummaryPanel({ quotationId }: { quotationId: string | null }) {
  const { state, reload } = useAiResource<{ summary: DealSummary; quoteNumber: string }>(
    quotationId ? `/api/ai/summary/${quotationId}` : null,
  );

  if (!quotationId) return <NoDeal what="a summary" />;
  if (state.status === "loading" || state.status === "idle") return <Skeleton lines={6} />;
  if (state.status === "failed") return <Failure message={state.message} onRetry={reload} />;

  return (
    <div className="space-y-3">
      {SUMMARY_SECTIONS.map(([key, label]) => (
        <div key={key}>
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">
            {label}
          </h3>
          <p className="text-xs text-slate-700 leading-relaxed">{state.data.summary[key]}</p>
        </div>
      ))}
      <Provenance />
    </div>
  );
}

// ---------------------------------------------------------------------------
// §4 Next Best Action, with §16 explainability
// ---------------------------------------------------------------------------

const IMPACT_LABELS: [keyof NextBestAction["expectedImpact"], string][] = [
  ["revenue", "Revenue"],
  ["margin", "Margin"],
  ["risk", "Risk"],
  ["approval", "Approval"],
];

const CONFIDENCE_STYLE: Record<NextBestAction["confidence"], string> = {
  high: "bg-emerald-50 text-emerald-700 border-emerald-200",
  medium: "bg-amber-50 text-amber-800 border-amber-200",
  low: "bg-slate-100 text-slate-600 border-slate-200",
};

export function NextActionPanel({ quotationId }: { quotationId: string | null }) {
  const [showWhy, setShowWhy] = useState(false);
  const { state, reload } = useAiResource<{ action: NextBestAction }>(
    quotationId ? `/api/ai/next-action/${quotationId}` : null,
  );

  if (!quotationId) return <NoDeal what="a recommended action" />;
  if (state.status === "loading" || state.status === "idle") return <Skeleton lines={5} />;
  if (state.status === "failed") return <Failure message={state.message} onRetry={reload} />;

  const { action } = state.data;

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-xs font-bold text-indigo-950 leading-snug">{action.title}</h3>
          <span
            className={`shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
              CONFIDENCE_STYLE[action.confidence]
            }`}
          >
            {action.confidence}
          </span>
        </div>
        <p className="text-[11px] text-indigo-900/80 mt-1.5 leading-relaxed">{action.reason}</p>
      </div>

      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
          Expected impact
        </h4>
        <dl className="space-y-1">
          {IMPACT_LABELS.map(([key, label]) => (
            <div className="flex gap-2 text-[11px]" key={key}>
              <dt className="w-16 shrink-0 text-slate-500">{label}</dt>
              <dd className="text-slate-800">{action.expectedImpact[key]}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* §16 - facts and recommendation are shown as different things, because
          they are. The facts below are quoted from the deal; the card above is
          a suggestion about them. */}
      <div>
        <button
          className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1"
          onClick={() => setShowWhy((current) => !current)}
          type="button"
        >
          <svg
            className={`w-3 h-3 transition-transform ${showWhy ? "rotate-90" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
          </svg>
          Why this recommendation?
        </button>

        {showWhy && (
          <div className="mt-1.5 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 space-y-1.5">
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
              Facts from this deal
            </p>
            {action.facts.map((fact) => (
              <p className="text-[11px] text-slate-700 flex gap-1.5 leading-relaxed" key={fact}>
                <span className="text-slate-400 shrink-0">•</span>
                <span>{fact}</span>
              </p>
            ))}
          </div>
        )}
      </div>

      <Provenance />
    </div>
  );
}

// ---------------------------------------------------------------------------
// §5 What-if Deal Simulator
// ---------------------------------------------------------------------------

export function SimulatorPanel({ quotationId }: { quotationId: string | null }) {
  const { state, reload } = useAiResource<{ scenarios: ComparedScenario[] }>(
    quotationId ? `/api/ai/scenarios/${quotationId}` : null,
  );

  if (!quotationId) return <NoDeal what="alternative scenarios" />;
  if (state.status === "loading" || state.status === "idle") return <Skeleton lines={7} />;
  if (state.status === "failed") return <Failure message={state.message} onRetry={reload} />;

  const scenarios = state.data.scenarios;
  if (scenarios.length < 2) {
    return <p className="text-[11px] text-slate-500">No workable alternatives were found for this deal.</p>;
  }

  return (
    <div className="space-y-2.5">
      {scenarios.map((scenario, index) => {
        const isCurrent = index === 0;
        return (
          <div
            className={`rounded-xl border p-3 ${
              isCurrent ? "border-slate-200 bg-slate-50/70" : "border-indigo-200 bg-white"
            }`}
            key={scenario.label + index}
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-xs font-bold text-slate-900 leading-snug">{scenario.label}</h3>
              {isCurrent && (
                <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-slate-500 bg-white border border-slate-200 px-1.5 py-0.5 rounded">
                  Now
                </span>
              )}
            </div>

            {scenario.rationale && (
              <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">{scenario.rationale}</p>
            )}

            <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
              <Metric
                delta={scenario.delta?.revenue ?? null}
                label="Revenue"
                value={scenario.revenue}
              />
              <Metric
                delta={scenario.delta?.marginPercentage ?? null}
                label="Margin"
                value={`${scenario.marginPercentage}%`}
              />
              <Metric
                delta={scenario.delta ? String(scenario.delta.riskScore) : null}
                invert
                label="Risk"
                value={String(scenario.riskScore)}
              />
            </dl>

            <p
              className={`mt-2 text-[10px] font-semibold ${
                scenario.approvalRequired ? "text-amber-700" : "text-emerald-700"
              }`}
            >
              {scenario.approvalRequired
                ? `Approval required${scenario.approverRole ? ` · ${scenario.approverRole.replace("_", " ")}` : ""}`
                : "No approval required"}
            </p>
          </div>
        );
      })}

      <p className="text-[10px] text-slate-400 leading-snug">
        Scenarios are suggested by AI. Every figure above is computed by the pricing, margin and
        approval engines — not by the model.
      </p>
    </div>
  );
}

/**
 * One figure with its change against the current deal.
 *
 * `invert` because a rising risk score is bad while rising revenue is good, and
 * the colour should mean "better" or "worse", not "up" or "down".
 */
function Metric({
  label,
  value,
  delta,
  invert = false,
}: {
  label: string;
  value: string;
  delta: string | null;
  invert?: boolean;
}) {
  const numeric = delta === null ? 0 : Number(delta);
  const improved = invert ? numeric < 0 : numeric > 0;
  const worsened = invert ? numeric > 0 : numeric < 0;

  return (
    <div>
      <dt className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="font-jetbrains font-semibold text-slate-900">{value}</dd>
      {delta !== null && numeric !== 0 && (
        <dd
          className={`font-jetbrains text-[10px] ${
            improved ? "text-emerald-600" : worsened ? "text-rose-600" : "text-slate-400"
          }`}
        >
          {numeric > 0 ? "+" : ""}
          {delta}
        </dd>
      )}
    </div>
  );
}

/** The line that keeps every generated card honest about what it is. */
function Provenance() {
  return (
    <p className="text-[10px] text-slate-400 leading-snug pt-1 border-t border-slate-100">
      AI assessment based on this deal&apos;s current data. Business rules remain authoritative.
    </p>
  );
}
