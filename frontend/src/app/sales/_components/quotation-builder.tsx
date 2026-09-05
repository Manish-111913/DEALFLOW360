"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatRupees } from "@/lib/money";
import type { BuilderData, UpsellCard } from "./types";

/**
 * The Quotation Builder, and with it the upsell panel (F-3) the brief places
 * inside quotation building rather than on a screen of its own.
 *
 * The old version faked this entirely: three hardcoded recommendations, and
 * adding the first one moved the margin from 22.0% to 23.1% because those two
 * numbers were written into the markup. Now the suggestions come from the
 * ranking engine with its own reasoning, and accepting one calls
 * `acceptUpsell` - which adds the line and re-runs the D21 recompute pipeline,
 * so the margin and risk that come back are the real ones. Sometimes the answer
 * is that the deal now needs approval it did not need before, which is the
 * behaviour worth demonstrating and the fake version could never show.
 */
export function QuotationBuilder({
  data,
  onClose,
}: {
  data: BuilderData;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);

  const suggestions = data.upsell.filter((card) => !dismissed.includes(card.productId));

  function act(card: UpsellCard, action: "accept" | "dismiss") {
    startTransition(async () => {
      const response = await fetch("/api/upsell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quotationId: data.quotationId,
          productId: card.productId,
          action,
          quantity: action === "accept" ? card.suggestedQuantity : undefined,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setProblem(body.error ?? "That could not be applied.");
        return;
      }

      if (action === "dismiss") {
        setDismissed((current) => [...current, card.productId]);
        return;
      }
      // Accepting rewrites the cart, the totals, the margin and possibly the
      // approval state, so the server component re-renders rather than this one
      // guessing at the new numbers.
      router.refresh();
    });
  }

  return (
    <div className="absolute inset-0 z-40 bg-white flex flex-col overflow-hidden">
      <div className="px-6 py-3 bg-white border-b border-slate-200 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-3">
          <button
            className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
            onClick={onClose}
            type="button"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                d="M10 19l-7-7m0 0l7-7m-7 7h18"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
            </svg>
          </button>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-sm font-bold text-slate-900">Quotation Builder</h2>
              <span className="font-jetbrains text-xs text-slate-500 font-semibold">
                {data.quoteNumber}
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                {data.status}
              </span>
              {data.approvalState !== "NONE" && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                  {data.approvalState.replace("_", " ")}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500">
              Client: <span className="font-semibold text-slate-800">{data.customerName}</span>
              {data.customerTier ? ` · ${data.customerTier} tier` : ""}
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Cart and financial summary */}
        <div className="flex-1 min-h-0 flex flex-col overflow-y-auto app-scroll border-r border-slate-200 p-6 space-y-5 bg-slate-50/50">
          <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Quotation Cart
              </span>
              <span className="text-[11px] text-slate-500">
                {data.customerTier ? `Reference Pricing: ${data.customerTier}` : "Reference Pricing"}
              </span>
            </div>
            <div className="p-4">
              <table className="w-full text-left text-xs">
                <thead className="text-[11px] text-slate-400 font-medium border-b border-slate-100">
                  <tr>
                    <th className="pb-2">Item &amp; Specification</th>
                    <th className="pb-2 text-center">Qty</th>
                    <th className="pb-2 text-right">Unit Price</th>
                    <th className="pb-2 text-center">Disc.</th>
                    <th className="pb-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.lines.length === 0 ? (
                    <tr>
                      <td className="py-6 text-center text-slate-500" colSpan={5}>
                        This quotation has no lines yet.
                      </td>
                    </tr>
                  ) : (
                    data.lines.map((line) => (
                      <tr className={line.isUpsell ? "bg-emerald-50/50" : ""} key={line.id}>
                        <td className="py-3">
                          <div className="font-semibold text-slate-900 flex items-center space-x-1.5">
                            <span>{line.productName}</span>
                            {line.isUpsell && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-100 text-emerald-700">
                                RECOMMENDED
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500">SKU: {line.sku}</div>
                        </td>
                        <td className="py-3 text-center font-jetbrains">{line.quantity}</td>
                        <td className="py-3 text-right font-jetbrains">
                          {formatRupees(line.unitPrice)}
                        </td>
                        <td className="py-3 text-center font-jetbrains">
                          {line.discountPercentage}%
                        </td>
                        <td
                          className={
                            "py-3 text-right font-bold font-jetbrains " +
                            (line.isUpsell ? "text-emerald-700" : "text-slate-900")
                          }
                        >
                          {formatRupees(line.lineTotal)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs p-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <span className="text-xs font-bold text-slate-800">Deal Financial Summary</span>
              <span className="text-[11px] text-slate-400">Recomputed on every change</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-3 text-xs">
              <Figure label="Subtotal" value={formatRupees(data.subtotal)} />
              <Figure label="Discount" value={formatRupees(data.discountAmount)} />
              <Figure
                label="Deal Margin"
                tone="emerald"
                value={`${data.marginPercentage}%`}
              />
              <Figure
                highlight
                label="Total Quotation"
                value={formatRupees(data.totalAmount)}
              />
            </div>
            <p className="text-[11px] text-slate-400 mt-3">
              Risk score {data.riskScore} / 100 · tax {formatRupees(data.taxAmount)}
            </p>
          </div>
        </div>

        {/* Recommendation panel (F-3) */}
        <div className="w-80 md:w-96 bg-white border-l border-slate-200 flex flex-col shrink-0 min-h-0 overflow-y-auto app-scroll">
          <div className="p-4 border-b border-slate-200 bg-slate-50/80">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-tight">
                Recommended for this deal
              </h3>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                {suggestions.length} recommendation{suggestions.length === 1 ? "" : "s"}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Ranked from what similar orders actually included
            </p>
          </div>

          <div className="p-4 space-y-3 flex-1">
            {problem && (
              <p className="text-[11px] text-rose-600 font-medium" role="alert">
                {problem}
              </p>
            )}

            {suggestions.length === 0 ? (
              <p className="text-[11px] text-slate-500">
                Nothing to suggest for this cart — every candidate is either already on the
                quotation or below its margin floor.
              </p>
            ) : (
              suggestions.map((card) => (
                <div
                  className={
                    "p-3.5 rounded-xl border shadow-2xs transition-all " +
                    (card.isPromoted ? "border-indigo-200 bg-indigo-50/30" : "border-slate-200 bg-white")
                  }
                  key={card.productId}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    {card.isPromoted ? (
                      <span className="text-[9px] font-bold uppercase tracking-wider bg-indigo-600 text-white px-1.5 py-0.5 rounded">
                        Promoted
                      </span>
                    ) : (
                      <span className="text-[10px] font-medium text-slate-400">Up-sell option</span>
                    )}
                    <span className="text-[11px] font-bold text-emerald-700 font-jetbrains">
                      +{formatRupees(card.marginImpact)}
                    </span>
                  </div>
                  <h4 className="text-xs font-bold text-slate-900 leading-snug">
                    {card.productName}
                  </h4>
                  {/* The engine's own grounding for the suggestion. */}
                  <p className="text-[11px] text-slate-600 mt-0.5 mb-1">{card.reason}</p>
                  <p className="text-[10px] text-slate-400 mb-2 font-jetbrains">
                    score {card.score} · margin {card.marginPercentage}%
                  </p>
                  <div
                    className={
                      "flex items-center justify-between pt-2 border-t " +
                      (card.isPromoted ? "border-indigo-100" : "border-slate-100")
                    }
                  >
                    <button
                      className="text-[11px] font-medium text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-60"
                      disabled={busy}
                      onClick={() => act(card, "dismiss")}
                      type="button"
                    >
                      Dismiss
                    </button>
                    <button
                      className="px-3 py-1 bg-indigo-600 text-white font-semibold text-[11px] rounded-lg hover:bg-indigo-700 shadow-xs transition-all disabled:opacity-60"
                      disabled={busy}
                      onClick={() => act(card, "accept")}
                      type="button"
                    >
                      {busy ? "Adding…" : `Add ${card.suggestedQuantity} to Quote`}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Figure({
  label,
  value,
  tone,
  highlight,
}: {
  label: string;
  value: string;
  tone?: "emerald";
  highlight?: boolean;
}) {
  return (
    <div
      className={
        "p-3 rounded-lg border " +
        (highlight ? "bg-indigo-50/60 border-indigo-100" : "bg-slate-50 border-slate-100")
      }
    >
      <span
        className={
          "text-[11px] block " + (highlight ? "text-indigo-900 font-medium" : "text-slate-500")
        }
      >
        {label}
      </span>
      <span
        className={
          "text-sm font-bold font-jetbrains " +
          (highlight ? "text-indigo-700" : tone === "emerald" ? "text-emerald-700" : "text-slate-800")
        }
      >
        {value}
      </span>
    </div>
  );
}
