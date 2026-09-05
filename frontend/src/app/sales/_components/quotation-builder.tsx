"use client";

import { useState } from "react";

/**
 * The Quotation Builder overlay, and with it the upsell panel (F-3) that the
 * brief describes as living inside quotation building rather than on a screen
 * of its own.
 *
 * Three recommendations sit down the right. Each can be added or dismissed, and
 * either way it stops counting towards the badge - that is what the original's
 * `updateRecCount` did, decrementing on both paths.
 *
 * Only the warranty moves the money. In the source screen adding it paused
 * 400ms on "Adding...", then appended an emerald row and rewrote the subtotal,
 * grand total and margin; the other two only appended a row. That asymmetry is
 * deliberate and preserved - it is what makes the promoted recommendation read
 * as the one with a margin story behind it.
 */

interface Recommendation {
  id: "warranty" | "support" | "install";
  /** The promoted card is the only one with the solid indigo tag. */
  promoted?: boolean;
  kicker: string;
  uplift: string;
  title: string;
  evidence: string;
}

const RECOMMENDATIONS: Recommendation[] = [
  {
    id: "warranty",
    promoted: true,
    kicker: "PROMOTED",
    uplift: "+₹8,400",
    title: "Extended Warranty",
    evidence: "72% of similar orders include this",
  },
  {
    id: "support",
    kicker: "Up-sell Option",
    uplift: "+₹5,200",
    title: "Enterprise Support Pack",
    evidence: "58% of similar orders include this",
  },
  {
    id: "install",
    kicker: "Cross-sell Addon",
    uplift: "+₹2,100",
    title: "Installation Kit",
    evidence: "41% of similar orders include this",
  },
];

/** The cart line each recommendation becomes once added. */
const CART_LINES = {
  warranty: {
    title: "Extended Warranty (3-Year Next Business Day)",
    detail: "72% attachment rate bundle",
    quantity: "1",
    unitPrice: "₹12,000",
    total: "₹12,000",
    rowStyle: "bg-emerald-50/50",
    totalStyle: "text-emerald-700",
    recommended: true,
  },
  support: {
    title: "Enterprise Support Pack",
    detail: "24/7 dedicated CPQ SLA",
    quantity: "1",
    unitPrice: "₹8,000",
    total: "₹8,000",
    rowStyle: "",
    totalStyle: "text-slate-900",
    recommended: false,
  },
  install: {
    title: "Installation Kit",
    detail: "Fast-track enterprise rack & peripherals setup",
    quantity: "1",
    unitPrice: "₹3,500",
    total: "₹3,500",
    rowStyle: "",
    totalStyle: "text-slate-900",
    recommended: false,
  },
} as const;

type RecommendationId = Recommendation["id"];

export function QuotationBuilder({ onClose }: { onClose: () => void }) {
  const [added, setAdded] = useState<RecommendationId[]>([]);
  const [dismissed, setDismissed] = useState<RecommendationId[]>([]);
  const [addingWarranty, setAddingWarranty] = useState(false);

  const remaining = RECOMMENDATIONS.length - added.length - dismissed.length;
  const warrantyAdded = added.includes("warranty");

  function add(id: RecommendationId) {
    if (id !== "warranty") {
      setAdded((current) => [...current, id]);
      return;
    }
    // The warranty is the one that pauses on "Adding..." before it lands.
    setAddingWarranty(true);
    setTimeout(() => {
      setAddingWarranty(false);
      setAdded((current) => [...current, "warranty"]);
    }, 400);
  }

  return (
    <div className="absolute inset-0 z-40 bg-white flex flex-col overflow-hidden">
      {/* Builder header */}
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
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-sm font-bold text-slate-900">Quotation Builder</h2>
              <span className="font-jetbrains text-xs text-slate-500 font-semibold">DF-2024-1082</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                Draft
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              Client: <span className="font-semibold text-slate-800">Acme Industries</span> · Cloud
              Migration &amp; ERP Deal Progression
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <button
            className="px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50"
            type="button"
          >
            Save Draft
          </button>
          <button
            className="px-3.5 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 shadow-sm shadow-indigo-200"
            type="button"
          >
            Submit for Approval
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: cart and financial summary */}
        <div className="flex-1 flex flex-col overflow-y-auto border-r border-slate-200 p-6 space-y-5 bg-slate-50/50">
          <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Quotation Cart
              </span>
              <span className="text-[11px] text-slate-500">Reference Pricing: Tier 1 Commercial</span>
            </div>
            <div className="p-4">
              <table className="w-full text-left text-xs">
                <thead className="text-[11px] text-slate-400 font-medium border-b border-slate-100 pb-2">
                  <tr>
                    <th className="pb-2">ITEM &amp; SPECIFICATION</th>
                    <th className="pb-2 text-center">QTY</th>
                    <th className="pb-2 text-right">UNIT PRICE</th>
                    <th className="pb-2 text-right">TOTAL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td className="py-3">
                      <div className="font-semibold text-slate-900">Laptop Pro 16&quot; Enterprise</div>
                      <div className="text-[11px] text-slate-500">Core i9, 32GB RAM, 1TB SSD</div>
                    </td>
                    <td className="py-3 text-center font-jetbrains">10</td>
                    <td className="py-3 text-right font-jetbrains">₹84,000</td>
                    <td className="py-3 text-right font-bold text-slate-900 font-jetbrains">₹8,40,000</td>
                  </tr>
                  {added.map((id) => {
                    const line = CART_LINES[id];
                    return (
                      <tr key={id} className={line.rowStyle}>
                        <td className="py-3">
                          <div className="font-semibold text-slate-900 flex items-center space-x-1.5">
                            <span>{line.title}</span>
                            {line.recommended && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-100 text-emerald-700">
                                RECOMMENDED
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500">{line.detail}</div>
                        </td>
                        <td className="py-3 text-center font-jetbrains">{line.quantity}</td>
                        <td className="py-3 text-right font-jetbrains">{line.unitPrice}</td>
                        <td className={"py-3 text-right font-bold font-jetbrains " + line.totalStyle}>
                          {line.total}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs p-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <span className="text-xs font-bold text-slate-800">Deal Financial Summary</span>
              <span className="text-[11px] text-slate-400">Standard Margins &amp; Rebate</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-3 text-xs">
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                <span className="text-slate-500 text-[11px] block">Subtotal</span>
                <span className="text-sm font-bold font-jetbrains text-slate-800">
                  {warrantyAdded ? "₹8,52,000" : "₹8,40,000"}
                </span>
              </div>
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                <span className="text-slate-500 text-[11px] block">Discount</span>
                <span className="text-sm font-bold font-jetbrains text-slate-800">₹0 (0%)</span>
              </div>
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                <span className="text-slate-500 text-[11px] block">Deal Margin</span>
                <div className="flex items-center space-x-1.5">
                  <span className="text-sm font-bold font-jetbrains text-emerald-700">
                    {warrantyAdded ? "23.1%" : "22.0%"}
                  </span>
                  {warrantyAdded && (
                    <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-700 font-jetbrains">
                      +1.1 pts
                    </span>
                  )}
                </div>
              </div>
              <div className="bg-indigo-50/60 p-3 rounded-lg border border-indigo-100">
                <span className="text-indigo-900 text-[11px] block font-medium">Total Quotation</span>
                <span className="text-sm font-extrabold font-jetbrains text-indigo-700">
                  {warrantyAdded ? "₹8.52 L" : "₹8.40 L"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: the recommendation panel */}
        <div className="w-80 md:w-96 bg-white border-l border-slate-200 flex flex-col shrink-0 overflow-y-auto">
          <div className="p-4 border-b border-slate-200 bg-slate-50/80">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-1.5">
                <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                  />
                </svg>
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-tight">
                  Recommended for this deal
                </h3>
              </div>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                {remaining} recommendations
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Relevant products and upsells based on this quotation
            </p>
          </div>

          <div className="p-4 space-y-3 flex-1 overflow-y-auto">
            {RECOMMENDATIONS.filter((rec) => !dismissed.includes(rec.id)).map((rec) => (
              <RecommendationCard
                key={rec.id}
                recommendation={rec}
                added={added.includes(rec.id)}
                adding={rec.id === "warranty" && addingWarranty}
                onAdd={() => add(rec.id)}
                onDismiss={() => setDismissed((current) => [...current, rec.id])}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function RecommendationCard({
  recommendation,
  added,
  adding,
  onAdd,
  onDismiss,
}: {
  recommendation: Recommendation;
  added: boolean;
  adding: boolean;
  onAdd: () => void;
  onDismiss: () => void;
}) {
  const promoted = recommendation.promoted;

  return (
    <div
      className={
        "p-3.5 rounded-xl border shadow-2xs transition-all " +
        (promoted ? "border-indigo-200 bg-indigo-50/30" : "border-slate-200 bg-white")
      }
    >
      <div className="flex items-center justify-between mb-1.5">
        {promoted ? (
          <span className="text-[9px] font-bold uppercase tracking-wider bg-indigo-600 text-white px-1.5 py-0.5 rounded">
            {recommendation.kicker}
          </span>
        ) : (
          <span className="text-[10px] font-medium text-slate-400">{recommendation.kicker}</span>
        )}
        <span className="text-[11px] font-bold text-emerald-700 font-jetbrains">
          {recommendation.uplift}
        </span>
      </div>
      <h4 className="text-xs font-bold text-slate-900 leading-snug">{recommendation.title}</h4>
      <p className="text-[11px] text-slate-600 mt-0.5 mb-2">{recommendation.evidence}</p>
      <div
        className={
          "flex items-center justify-between pt-2 border-t " +
          (promoted ? "border-indigo-100" : "border-slate-100")
        }
      >
        <button
          className="text-[11px] font-medium text-slate-400 hover:text-slate-600 transition-colors"
          onClick={onDismiss}
          type="button"
        >
          Dismiss
        </button>
        {added ? (
          <button
            className="px-3 py-1 bg-emerald-600 text-white font-semibold text-[11px] rounded-lg transition-all cursor-default"
            disabled
            type="button"
          >
            Added ✓
          </button>
        ) : (
          <button
            className={
              "px-3 py-1 bg-indigo-600 text-white font-semibold text-[11px] rounded-lg hover:bg-indigo-700 shadow-sm shadow-indigo-200 transition-all " +
              (adding ? "opacity-75" : "")
            }
            disabled={adding}
            onClick={onAdd}
            type="button"
          >
            {adding ? "Adding..." : "[ Add to Quote ]"}
          </button>
        )}
      </div>
    </div>
  );
}
