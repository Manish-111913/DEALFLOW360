"use client";

import { useToast } from "@/components/toast";
import type { DealFilter } from "./deal-filter";

/**
 * The five funnel stage cards.
 *
 * Each card is one row in STAGES: the colours differ per stage, so rather than
 * building class names by interpolation - which Tailwind cannot see and would
 * strip from the build - each stage carries its finished class strings.
 *
 * Note that stage 5 (Fulfillment) is the one card that does not filter the
 * table; in the source screen it only raised a toast, so `filter` is null.
 */

interface Stage {
  title: string;
  deals: string;
  value: string;
  /** How wide the bar under the card runs. */
  barWidth: string;
  filter: DealFilter | null;
  toast: string;
  card: string;
  header: string;
  label: string;
  badge: string;
  track: string;
  bar: string;
}

const STAGES: Stage[] = [
  {
    title: "1. Draft",
    deals: "12 deals",
    value: "₹42.0L",
    barWidth: "34%",
    filter: "draft",
    toast: "Showing Draft deals",
    card: "border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/40",
    header: "text-slate-500",
    label: "text-slate-700",
    badge: "bg-slate-100 text-slate-600",
    track: "bg-slate-100",
    bar: "bg-slate-400",
  },
  {
    title: "2. Pending Approval",
    deals: "4 deals",
    value: "₹18.0L",
    barWidth: "15%",
    filter: "action",
    toast: "Showing Pending Approval deals",
    card: "border-amber-200/90 bg-amber-50/20 hover:bg-amber-50/40",
    header: "text-amber-700",
    label: "text-amber-800",
    badge: "bg-amber-100 text-amber-800",
    track: "bg-amber-100",
    bar: "bg-amber-500",
  },
  {
    title: "3. Negotiation",
    deals: "3 deals",
    value: "₹14.0L",
    barWidth: "11%",
    filter: "action",
    toast: "Showing Under Negotiation deals",
    card: "border-indigo-200/90 bg-indigo-50/20 hover:bg-indigo-50/40",
    header: "text-indigo-700",
    label: "text-indigo-800",
    badge: "bg-indigo-100 text-indigo-800",
    track: "bg-indigo-100",
    bar: "bg-indigo-600",
  },
  {
    title: "4. Approved",
    deals: "6 deals",
    value: "₹29.0L",
    barWidth: "23%",
    filter: "all",
    toast: "Showing Approved deals",
    card: "border-emerald-200/90 bg-emerald-50/20 hover:bg-emerald-50/40",
    header: "text-emerald-700",
    label: "text-emerald-800",
    badge: "bg-emerald-100 text-emerald-800",
    track: "bg-emerald-100",
    bar: "bg-emerald-600",
  },
  {
    title: "5. Fulfillment",
    deals: "5 deals",
    value: "₹21.0L",
    barWidth: "17%",
    filter: null,
    toast: "Showing Fulfillment stage deals",
    card: "border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/40",
    header: "text-slate-500",
    label: "text-slate-700",
    badge: "bg-slate-100 text-slate-600",
    track: "bg-slate-100",
    bar: "bg-slate-600",
  },
];

export function PipelineOverview({ onFilter }: { onFilter: (filter: DealFilter) => void }) {
  const showToast = useToast();

  return (
    <section className="bg-white border border-slate-200/90 rounded-xl shadow-2xs p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-display text-sm font-bold text-slate-900">
              Sales Pipeline Overview
            </h2>
            <span className="px-2 py-0.5 text-[11px] font-medium bg-indigo-50 text-indigo-700 rounded-full border border-indigo-100">
              Live Funnel
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">30 deals • ₹1.24 Cr in active pipeline</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50 shadow-2xs transition-colors"
            onClick={() => showToast("Exporting pipeline summary report")}
            type="button"
          >
            <span className="material-symbols-outlined text-[16px] text-slate-400">download</span>
            Export Report
          </button>
          <button
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
            onClick={() => showToast("Opening pipeline board view")}
            type="button"
          >
            <span>Pipeline Board</span>
            <span className="text-[13px]">→</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-4">
        {STAGES.map((stage) => (
          <div
            key={stage.title}
            className={"p-3.5 rounded-lg border transition-all cursor-pointer relative " + stage.card}
            onClick={() => {
              if (stage.filter) onFilter(stage.filter);
              showToast(stage.toast);
            }}
          >
            <div className={"flex items-center justify-between text-xs mb-1.5 " + stage.header}>
              <span className={"font-semibold uppercase tracking-wider text-[11px] " + stage.label}>
                {stage.title}
              </span>
              <span
                className={
                  "px-1.5 py-0.5 text-[10px] font-jetbrains font-medium rounded " + stage.badge
                }
              >
                {stage.deals}
              </span>
            </div>
            <div className="font-jetbrains text-xl font-bold text-slate-900">{stage.value}</div>
            <div className={"w-full h-1.5 rounded-full mt-2.5 overflow-hidden " + stage.track}>
              <div className={"h-full rounded-full " + stage.bar} style={{ width: stage.barWidth }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
