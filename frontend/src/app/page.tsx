"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AppShell,
  AppWindow,
  StatusBar,
  WindowScroll,
} from "@/components/app-shell";
import { ToastProvider, useToast } from "@/components/toast";
import { ROUTES } from "@/lib/navigation";
import {
  PAGE_SUBTITLE,
  PAGE_TITLE,
  SCROLL_PADDING,
} from "@/components/design-tokens";
import { AssistantChat } from "./_command-center/assistant-chat";
import { AttentionRequired } from "./_command-center/attention-required";
import { BottomRow } from "./_command-center/bottom-row";
import { AppDock } from "@/components/app-dock";
import { CommandToast } from "./_command-center/command-toast";
import { KpiStrip } from "./_command-center/kpi-strip";
import { PipelineOverview } from "./_command-center/pipeline-overview";
import { RecentDeals, dealFilterToast } from "./_command-center/recent-deals";
import { SearchModal } from "./_command-center/search-modal";
import type { DealFilter } from "./_command-center/deal-filter";

/**
 * Screen 1 - the command centre.
 *
 * The one piece of state shared across sections is the Recent Deals filter:
 * two KPI tiles, four of the five pipeline cards and the table's own tabs all
 * set it, so it lives here rather than inside the table.
 *
 * This was the only screen with no window frame - the whole document scrolled
 * behind a floating dock, and it had no status bar. It now sits in the same
 * AppShell as the other six: the greeting and quick actions are a fixed strip,
 * the dashboard is the single scroll region, and the status bar is pinned to the
 * bottom of the card.
 */
export default function CommandCenterPage() {
  return (
    <ToastProvider>
      <CommandCenter />
      <CommandToast />
    </ToastProvider>
  );
}

function CommandCenter() {
  const showToast = useToast();
  const router = useRouter();
  const [filter, setFilter] = useState<DealFilter>("all");
  const [searchOpen, setSearchOpen] = useState(false);

  // Cmd/Ctrl+K opens the palette, Escape closes it - as in the source screen.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape") setSearchOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function applyFilter(next: DealFilter) {
    setFilter(next);
    showToast(dealFilterToast(next));
  }

  return (
    <AppShell className="screen-command-center mac-desktop-bg font-inter text-slate-900 selection:bg-indigo-500 selection:text-white">
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />

      <AppWindow>
        {/* DASHBOARD MAIN HEADER - the fixed strip above the scroll region */}
        <div className="shrink-0 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-slate-200/80 px-6 py-3.5 bg-white">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <h1 className={"font-display " + PAGE_TITLE}>Good morning, Priya</h1>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-50 text-indigo-700 border border-indigo-100 shadow-2xs">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5" />
                Monday, 5 September · 12 active deals
              </span>
            </div>
            <p className={PAGE_SUBTITLE}>Here&apos;s what&apos;s happening across your sales operations.</p>
          </div>

          {/* Quick Action Buttons on same level */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs font-semibold px-3 py-1.5 rounded-lg text-xs transition-colors cursor-pointer"
              onClick={() => showToast("Launching new quotation composer")}
              type="button"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              <span className="font-display font-semibold">New Quotation</span>
            </button>
            <button
              className="inline-flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 font-medium px-3 py-1.5 rounded-lg text-xs shadow-xs transition-colors cursor-pointer"
              onClick={() => {
                showToast("Opening Approvals queue");
                router.push(ROUTES.approvals);
              }}
              type="button"
            >
              <span className="material-symbols-outlined text-[18px] text-slate-500">fact_check</span>
              <span>Review Approvals</span>
            </button>
            <button
              className="inline-flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 font-medium px-3 py-1.5 rounded-lg text-xs shadow-xs transition-colors cursor-pointer"
              onClick={() => {
                showToast("Opening Sales Workspace");
                router.push(ROUTES.sales);
              }}
              type="button"
            >
              <span className="material-symbols-outlined text-[18px] text-slate-500">table_chart</span>
              <span>Open Sales Workspace</span>
            </button>
          </div>
        </div>

        {/* MAIN DASHBOARD CONTENT */}
        <WindowScroll className={SCROLL_PADDING}>
          <KpiStrip onFilter={applyFilter} />
          <PipelineOverview onFilter={applyFilter} />

          <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <RecentDeals filter={filter} onFilter={applyFilter} />
            <AttentionRequired />
          </section>

          <BottomRow />
        </WindowScroll>

        <StatusBar />
      </AppWindow>

      <AppDock />
      <AssistantChat />
    </AppShell>
  );
}
