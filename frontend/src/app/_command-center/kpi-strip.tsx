"use client";

import { useToast } from "@/components/toast";
import type { DealFilter } from "./deal-filter";

/**
 * The five-tile KPI strip.
 *
 * The first two tiles filter the Recent Deals table below; the other three only
 * raised a toast in the source screen, and still do.
 */
export function KpiStrip({ onFilter }: { onFilter: (filter: DealFilter) => void }) {
  const showToast = useToast();

  return (
    <section className="bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden">
      <div className="grid grid-cols-2 md:grid-cols-5 divide-y md:divide-y-0 md:divide-x divide-slate-100">
        {/* KPI 1 */}
        <div className="p-4 sm:p-5 cursor-pointer hover:bg-slate-50/60 transition-colors group" onClick={() => onFilter("all")}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Active deals</span>
            <span className="material-symbols-outlined text-[18px] text-indigo-500 group-hover:scale-110 transition-transform">
              view_kanban
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-jetbrains text-xl font-bold tracking-tight text-slate-900">12</span>
            <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.2 rounded">
              +2 this wk
            </span>
          </div>
          <span className="text-[11px] text-slate-400 mt-1 block font-medium">Pipeline active count</span>
        </div>

        {/* KPI 2 */}
        <div className="p-4 sm:p-5 cursor-pointer hover:bg-slate-50/60 transition-colors group" onClick={() => onFilter("action")}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Pending approvals</span>
            <span className="material-symbols-outlined text-[18px] text-amber-500 group-hover:scale-110 transition-transform">
              hourglass_top
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-jetbrains text-xl font-bold tracking-tight text-amber-600">4</span>
            <span className="text-[11px] font-medium text-amber-600 bg-amber-50 px-1.5 py-0.2 rounded">
              Action needed
            </span>
          </div>
          <span className="text-[11px] text-slate-400 mt-1 block font-medium">Discounts &amp; terms</span>
        </div>

        {/* KPI 3 */}
        <div
          className="p-4 sm:p-5 cursor-pointer hover:bg-slate-50/60 transition-colors group"
          onClick={() => showToast("Filtered for deals requiring urgent attention")}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">At-risk deals</span>
            <span className="material-symbols-outlined text-[18px] text-rose-500 group-hover:scale-110 transition-transform">
              warning
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-jetbrains text-xl font-bold tracking-tight text-rose-600">3</span>
            <span className="text-[11px] font-medium text-rose-600 bg-rose-50 px-1.5 py-0.2 rounded">
              Stalled &gt; 5d
            </span>
          </div>
          <span className="text-[11px] text-slate-400 mt-1 block font-medium">Requires follow-up</span>
        </div>

        {/* KPI 4 */}
        <div
          className="p-4 sm:p-5 cursor-pointer hover:bg-slate-50/60 transition-colors group"
          onClick={() => showToast("Viewing warehouse allocations log")}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Pending fulfillment</span>
            <span className="material-symbols-outlined text-[18px] text-indigo-500 group-hover:scale-110 transition-transform">
              local_shipping
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-jetbrains text-xl font-bold tracking-tight text-slate-900">5</span>
            <span className="text-[11px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded">2 partial</span>
          </div>
          <span className="text-[11px] text-slate-400 mt-1 block font-medium">Warehouse allocations</span>
        </div>

        {/* KPI 5 */}
        <div
          className="p-4 sm:p-5 cursor-pointer hover:bg-slate-50/60 transition-colors group col-span-2 md:col-span-1"
          onClick={() => showToast("Viewing outstanding receivables schedule")}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Outstanding invoices</span>
            <span className="material-symbols-outlined text-[18px] text-slate-400 group-hover:scale-110 transition-transform">
              receipt_long
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-jetbrains text-xl font-bold tracking-tight text-slate-900">7</span>
            <span className="text-[11px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded">₹38.4L</span>
          </div>
          <span className="text-[11px] text-slate-400 mt-1 block font-medium">Pending collection</span>
        </div>
      </div>
    </section>
  );
}
