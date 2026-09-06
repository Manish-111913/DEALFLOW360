"use client";

import { useState, useTransition } from "react";
import { CARD } from "@/components/design-tokens";
import type { SettingsData } from "./settings-client";

/**
 * "Test a Deal Policy" — would this combination need approval, and by whom?
 *
 * The answer comes from the server, from the same two engines a real quotation
 * goes through. Nothing about the outcome is computed here: a second copy of
 * the ceiling rules living in a React component is exactly how a validator ends
 * up disagreeing with the system it is meant to validate.
 *
 * It also reads the *saved* configuration, not the unsaved edits above it. That
 * is deliberate and the panel says so — testing against a ceiling that only
 * exists in the browser would answer a question about a system that does not
 * exist yet.
 */

interface PolicyResult {
  tier: string;
  categoryName: string;
  requestedDiscount: string;
  effectiveCeiling: string;
  ceilingSource: "CATEGORY_POLICY" | "TIER_DEFAULT" | "FALLBACK";
  variance: string;
  overCeiling: boolean;
  approvalRequired: boolean;
  reviewers: { stepOrder: number; role: string }[];
  reason: string;
  steps: string[];
}

const SOURCE_LABEL: Record<PolicyResult["ceilingSource"], string> = {
  CATEGORY_POLICY: "Category override",
  TIER_DEFAULT: "Tier default",
  FALLBACK: "Fallback ceiling",
};

const ROLE_LABEL: Record<string, string> = {
  SALES_MANAGER: "Sales Manager",
  FINANCE_OPS: "Finance / Operations",
};

const FIELD =
  "w-full text-xs font-medium border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 py-2 px-3";

export function PolicyTester({ data }: { data: SettingsData }) {
  const [tier, setTier] = useState(data.tierCeilings[0]?.tier ?? "GOLD");
  const [categoryId, setCategoryId] = useState(data.categories[0]?.id ?? "");
  const [discount, setDiscount] = useState("18");
  const [result, setResult] = useState<PolicyResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  function evaluate() {
    if (!categoryId) {
      setProblem("Choose a product category.");
      return;
    }
    startTransition(async () => {
      const response = await fetch("/api/settings/policy-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, categoryId, discountPercentage: discount }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setResult(null);
        setProblem(body.error ?? "The policy could not be evaluated");
        return;
      }
      setProblem(null);
      setResult(body as PolicyResult);
    });
  }

  return (
    <section className={CARD + " p-5"} id="simulator">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-4 border-b border-slate-100">
        <div>
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
            Test a Deal Policy
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Ask the live rules whether these terms would need approval. Nothing is saved.
          </p>
        </div>
        <span className="text-xs font-medium text-slate-500">Runs the real engines</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end mb-4">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="test-tier">
            Customer Tier
          </label>
          <select
            className={FIELD}
            id="test-tier"
            onChange={(event) => setTier(event.target.value)}
            value={tier}
          >
            {data.tierCeilings.map((row) => (
              <option key={row.tier} value={row.tier}>
                {row.tier}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            className="block text-xs font-semibold text-slate-700 mb-1"
            htmlFor="test-category"
          >
            Product Category
          </label>
          <select
            className={FIELD}
            id="test-category"
            onChange={(event) => setCategoryId(event.target.value)}
            value={categoryId}
          >
            {data.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            className="block text-xs font-semibold text-slate-700 mb-1"
            htmlFor="test-discount"
          >
            Requested Discount
          </label>
          <input
            className={FIELD + " font-jetbrains font-bold text-slate-800"}
            id="test-discount"
            inputMode="decimal"
            onChange={(event) => setDiscount(event.target.value)}
            type="text"
            value={discount}
          />
        </div>

        <button
          className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition disabled:opacity-60"
          disabled={busy}
          onClick={evaluate}
          type="button"
        >
          {busy ? "Evaluating…" : "Evaluate Policy"}
        </button>
      </div>

      {problem && <p className="text-[11px] text-rose-600 font-medium mb-3">{problem}</p>}

      {result && (
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-4 text-xs">
            <div className="flex flex-wrap items-center gap-6">
              <Figure
                label="Effective Ceiling"
                sub={SOURCE_LABEL[result.ceilingSource]}
                value={`${result.effectiveCeiling}%`}
              />
              <Divider />
              <Figure
                label="Variance"
                tone={result.overCeiling ? "text-rose-600" : "text-emerald-600"}
                value={
                  (Number(result.variance) > 0 ? "+" : "") +
                  result.variance +
                  "%" +
                  (result.overCeiling ? " (breach)" : " (within)")
                }
              />
              <Divider />
              <Figure
                label="Approval Required"
                tone={result.approvalRequired ? "text-amber-700" : "text-emerald-600"}
                value={result.approvalRequired ? "Yes" : "No"}
              />
              <Divider />
              <Figure
                label="Required Reviewer"
                value={
                  result.reviewers.length === 0
                    ? "None"
                    : result.reviewers
                        .map((r) => ROLE_LABEL[r.role] ?? r.role)
                        .join(" → ")
                }
              />
            </div>
            <span
              className={
                "px-2.5 py-1 text-[11px] font-semibold rounded-md border " +
                (result.approvalRequired
                  ? "bg-amber-50 border-amber-200 text-amber-800"
                  : "bg-emerald-50 border-emerald-200 text-emerald-800")
              }
            >
              {result.approvalRequired ? "Review Triggered" : "Straight Through"}
            </span>
          </div>

          {/* D22: the engine explains itself, and the screen prints that rather
              than paraphrasing it. */}
          <div className="pt-3 border-t border-slate-200/80">
            <p className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
              How this ceiling was reached
            </p>
            <ol className="text-[11px] text-slate-600 space-y-0.5 list-decimal list-inside">
              {result.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <p className="text-[11px] text-slate-500 mt-2">{result.reason}</p>
          </div>

          <p className="text-[11px] text-slate-400 pt-2 border-t border-slate-200/80">
            Evaluated against the saved configuration, and on discount alone — a real deal also
            carries a risk score, so it can need more review than this, never less.
          </p>
        </div>
      )}
    </section>
  );
}

function Figure({
  label,
  value,
  sub,
  tone = "text-slate-800",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div>
      <span className="text-[11px] text-slate-500 block">{label}</span>
      <span className={"font-bold text-sm " + tone}>{value}</span>
      {sub && <span className="block text-[10px] text-slate-400">{sub}</span>}
    </div>
  );
}

function Divider() {
  return <div className="h-8 w-px bg-slate-200" />;
}
