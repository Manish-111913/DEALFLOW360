"use client";

import Image from "next/image";
import { useState } from "react";
import {
  AgentButton,
  AppShell,
  AppWindow,
  StatusBar,
} from "@/components/app-shell";
import { ToastProvider, useToast, useToastState } from "@/components/toast";
import { DealHealthRow, HEALTH_ROWS } from "./_components/deal-rows";
import {
  CHROME_BAR,
  PAGE_SUBTITLE,
  PAGE_TITLE,
  SCROLL_PADDING,
} from "@/components/design-tokens";
import { AppDock } from "@/components/app-dock";

/**
 * Screen 7 - Deal Health & Anomaly Dashboard.
 *
 * A severity-sorted table on the left and, on the right, the drawer for the one
 * deal under review - Acme Industries at 57/100, with the five deductions that
 * got it there.
 *
 * The only thing that moves is the Escalate button, so that is the only state
 * here. Its toast runs for 3s.
 */

const KPIS = [
  {
    label: "Total Active",
    value: "30",
    note: "100% Pipeline",
    card: "bg-white border-slate-200/80",
    labelStyle: "text-slate-500",
    valueStyle: "text-slate-900",
    noteStyle: "text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded font-medium",
    dot: null,
  },
  {
    label: "Critical",
    value: "2",
    note: "Immediate action",
    card: "bg-red-50/50 border-red-200",
    labelStyle: "text-red-700",
    valueStyle: "text-red-700",
    noteStyle: "text-red-600 font-medium",
    dot: "bg-red-500",
  },
  {
    label: "At Risk",
    value: "5",
    note: "Needs triage",
    card: "bg-amber-50/50 border-amber-200 ring-1 ring-amber-400/20",
    labelStyle: "text-amber-800",
    valueStyle: "text-amber-800",
    noteStyle: "text-amber-700 font-medium",
    dot: "bg-amber-500",
  },
  {
    label: "Watch",
    value: "8",
    note: "Minor anomalies",
    card: "bg-indigo-50/40 border-indigo-200",
    labelStyle: "text-indigo-700",
    valueStyle: "text-indigo-700",
    noteStyle: "text-indigo-600 font-medium",
    dot: "bg-indigo-500",
  },
  {
    label: "Healthy",
    value: "15",
    note: "On track",
    card: "bg-emerald-50/40 border-emerald-200 col-span-2 sm:col-span-1",
    labelStyle: "text-emerald-800",
    valueStyle: "text-emerald-800",
    noteStyle: "text-emerald-600 font-medium",
    dot: "bg-emerald-500",
  },
];

const QUICK_FILTERS = [
  { label: "Critical (2)", dot: "bg-red-500" },
  { label: "At Risk (5)", dot: "bg-amber-500" },
  { label: "Watch (8)", dot: "bg-indigo-500" },
  { label: "Healthy (15)", dot: "bg-emerald-500" },
];

const DEDUCTIONS = [
  { label: "Stalled Deal", points: "-20 pts", row: "bg-red-50/50 border-red-100", dot: "bg-red-500", text: "text-red-600" },
  { label: "Approval Delay", points: "-12 pts", row: "bg-amber-50/50 border-amber-100", dot: "bg-amber-500", text: "text-amber-600" },
  { label: "Backorder Risk", points: "-10 pts", row: "bg-slate-50 border-slate-200/80", dot: "bg-slate-400", text: "text-slate-600" },
  { label: "Discount Anomaly", points: "-10 pts", row: "bg-slate-50 border-slate-200/80", dot: "bg-slate-400", text: "text-slate-600" },
  { label: "Negotiation Friction", points: "-5 pts", row: "bg-slate-50 border-slate-200/80", dot: "bg-slate-400", text: "text-slate-600" },
];

const AVATAR_URL =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuBTflBle6OwjQdxxW41SKaooff6bmGBxKMoLypL0CV8Gm6KiejnqnbNZ_TQHcVueZulDp7WfO_vOPUThRP8BpV_6t2D0TQm5ty7zbsA3yeCqGNcnDgQm4TIFoWIjhPuuTdRdVsBmchoLYUHo-L6sQVzEyMTPbiytKsSBQNAaPSi6zigP0WJhQSjgvVKTqtF7fE1r5j6SaYEP4VHQA_onpRTPJjtmsfgGXarWxRkZtWG87PsWJE2usmI";

export default function DealHealthPage() {
  return (
    <ToastProvider durationMs={3000}>
      <DealHealth />
    </ToastProvider>
  );
}

function DealHealth() {
  const showToast = useToast();
  const [escalated, setEscalated] = useState(false);

  return (
    <AppShell className="screen-deal-health font-inter bg-[#f0f4f8] text-slate-800 select-none">
      <AppWindow>
        {/* Window header bar */}
        <header className={CHROME_BAR + " gap-4"}>
          <div className="flex items-center space-x-3.5">
            <div aria-hidden="true" className="flex items-center space-x-1.5">
              <span className="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] inline-block shadow-sm" />
              <span className="w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#dea123] inline-block shadow-sm" />
              <span className="w-3 h-3 rounded-full bg-[#27c93f] border border-[#1aab29] inline-block shadow-sm" />
            </div>
            <div className="h-4 w-px bg-slate-300 mx-1" />
            <div className="flex items-center text-xs font-medium text-slate-600 space-x-1.5">
              <span className="text-slate-500">Sales Operations</span>
              <span className="text-slate-400">/</span>
              <span className="text-indigo-600 font-semibold bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100">
                Deal Health &amp; Anomaly Engine
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-3.5">
            <div className="relative hidden sm:block w-72 md:w-80">
              <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-400">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                  />
                </svg>
              </div>
              <input
                className="w-full pl-8 pr-8 py-1 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 shadow-inner placeholder-slate-400 text-slate-700"
                placeholder="Search deals, quotations, customers (⌘K)"
                readOnly
                type="text"
              />
              <span className="absolute inset-y-0 right-0 pr-2 flex items-center text-[10px] text-slate-400 font-mono">
                ⌘K
              </span>
            </div>

            <button
              className="relative p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-200/50 rounded-lg transition-colors"
              title="Notifications"
              type="button"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                />
              </svg>
              <span className="absolute top-1 right-1 w-2 h-2 bg-indigo-600 rounded-full ring-2 ring-white" />
            </button>

            <div className="flex items-center space-x-2 pl-2 border-l border-slate-200">
              <Image
                alt="Priya Sharma"
                className="w-6 h-6 rounded-full ring-1 ring-slate-200 object-cover"
                height={24}
                src={AVATAR_URL}
                unoptimized
                width={24}
              />
              <div className="text-left hidden lg:block leading-tight">
                <p className="text-[11px] font-semibold text-slate-800">Priya Sharma</p>
                <p className="text-[9px] text-slate-500 font-medium">Sales Director</p>
              </div>
            </div>
          </div>
        </header>

        {/* Workspace */}
        <main className="flex-1 min-h-0 overflow-hidden flex flex-row relative bg-[#fcfdfe]">
          <section className={"flex-1 min-h-0 overflow-y-auto app-scroll flex flex-col pb-28 " + SCROLL_PADDING}>
            {/* Page header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/80 pb-4">
              <div>
                <div className="flex items-center space-x-2.5">
                  <h1 className={PAGE_TITLE}>Deal Health</h1>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                    Live Telemetry
                  </span>
                </div>
                <p className={PAGE_SUBTITLE}>
                  Monitor deals that need attention before they lose momentum.
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <div className="flex items-center space-x-1.5 text-xs text-slate-500 bg-slate-100/80 px-2.5 py-1.5 rounded-lg border border-slate-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-soft" />
                  <span className="text-[11px] font-medium">Evaluated: 2m ago</span>
                </div>
                <button
                  className="inline-flex items-center px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 shadow-xs transition-colors"
                  onClick={() => showToast("Health telemetry refreshed")}
                  type="button"
                >
                  <svg className="w-3.5 h-3.5 mr-1.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                    />
                  </svg>
                  Refresh
                </button>
                <button
                  className="inline-flex items-center px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors"
                  onClick={() => showToast("Deal health summary exported")}
                  type="button"
                >
                  <svg className="w-3.5 h-3.5 mr-1.5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                    />
                  </svg>
                  Export Summary
                </button>
              </div>
            </div>

            {/* Health summary strip */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {KPIS.map((kpi) => (
                <div
                  key={kpi.label}
                  className={"border rounded-xl p-3 flex flex-col justify-between shadow-xs " + kpi.card}
                >
                  {kpi.dot ? (
                    <div className="flex items-center justify-between">
                      <span
                        className={
                          "text-[11px] font-semibold uppercase tracking-wider " + kpi.labelStyle
                        }
                      >
                        {kpi.label}
                      </span>
                      <span className={"w-2 h-2 rounded-full " + kpi.dot} />
                    </div>
                  ) : (
                    <span className={"text-[11px] font-medium uppercase tracking-wider " + kpi.labelStyle}>
                      {kpi.label}
                    </span>
                  )}
                  <div className="flex items-baseline justify-between mt-1">
                    <span className={"text-xl font-bold " + kpi.valueStyle}>{kpi.value}</span>
                    <span className={"text-[10px] " + kpi.noteStyle}>{kpi.note}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Filter toolbar */}
            <div className="bg-white border border-slate-200/90 rounded-xl p-2.5 shadow-2xs space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="relative flex-1 min-w-[220px]">
                  <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-400">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                      />
                    </svg>
                  </div>
                  <input
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-700 placeholder-slate-400"
                    placeholder="Search deals, customers, quotations..."
                    type="text"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <FilterSelect
                    options={["Severity: All", "Critical Only", "At Risk Only", "Watch", "Healthy"]}
                  />
                  <FilterSelect
                    options={[
                      "Salesperson: All",
                      "Priya Sharma",
                      "Vikram Patel",
                      "Ananya Rao",
                      "Rahul Mehta",
                    ]}
                  />
                  <FilterSelect
                    options={[
                      "Deal Stage: All",
                      "Draft",
                      "Pending Approval",
                      "Under Negotiation",
                      "Approved",
                      "Fulfillment",
                    ]}
                  />
                  <button
                    className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 px-2.5 py-1.5 rounded-lg font-medium transition-colors"
                    type="button"
                  >
                    Reset
                  </button>
                </div>
              </div>

              <div className="flex items-center space-x-1 pt-1 border-t border-slate-100 text-xs overflow-x-auto">
                <button
                  className="px-2.5 py-1 rounded-md font-semibold bg-slate-900 text-white shadow-xs"
                  type="button"
                >
                  All Deals (30)
                </button>
                {QUICK_FILTERS.map((quick) => (
                  <button
                    key={quick.label}
                    className="px-2.5 py-1 rounded-md font-medium text-slate-600 hover:bg-slate-100 transition-colors flex items-center space-x-1"
                    type="button"
                  >
                    <span className={"w-2 h-2 rounded-full " + quick.dot} />
                    <span>{quick.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Main table */}
            <div className="bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden flex-1">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                  <thead className="bg-slate-50/75 border-b border-slate-100 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">
                    <tr>
                      <th className="py-3 px-3.5" scope="col">Deal &amp; Customer</th>
                      <th className="py-3 px-3" scope="col">Reference</th>
                      <th className="py-3 px-3" scope="col">Health Score</th>
                      <th className="py-3 px-3" scope="col">Severity</th>
                      <th className="py-3 px-3" scope="col">Primary Issue</th>
                      <th className="py-3 px-3" scope="col">Stage</th>
                      <th className="py-3 px-3" scope="col">Last Activity</th>
                      <th className="py-3 px-3 text-right" scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {HEALTH_ROWS.map((row) => (
                      <DealHealthRow key={row.reference} row={row} />
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="px-4 py-2.5 border-t border-slate-200/80 bg-slate-50/60 flex items-center justify-between text-xs text-slate-500">
                <span>Showing 7 of 30 active deals sorted by severity</span>
                <div className="flex items-center space-x-1">
                  <button
                    className="px-2 py-1 border border-slate-200 rounded bg-white text-slate-400 cursor-not-allowed"
                    type="button"
                  >
                    Previous
                  </button>
                  <button
                    className="px-2 py-1 border border-slate-200 rounded bg-white text-slate-600 hover:bg-slate-50"
                    type="button"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Right detail drawer */}
          <aside className="w-80 md:w-96 border-l border-slate-200 bg-white flex flex-col justify-between shrink-0 shadow-lg z-10 overflow-y-auto app-scroll pb-28">
            <div className="p-4 space-y-4">
              <div className="flex items-start justify-between border-b border-slate-100 pb-3">
                <div>
                  <div className="flex items-center space-x-2">
                    <h2 className="text-sm font-bold text-slate-900">Acme Industries</h2>
                    <span className="text-[10px] font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                      DF-2024-1082
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">Cloud Migration &amp; ERP</p>
                </div>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                  At Risk
                </span>
              </div>

              {/* Health Score Banner & Gauge */}
              <div className="bg-gradient-to-br from-amber-50/60 to-orange-50/30 rounded-xl p-3.5 border border-amber-200/80">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-semibold uppercase text-amber-800 tracking-wide">
                      Health Telemetry
                    </span>
                    <div className="flex items-baseline space-x-1 mt-0.5">
                      <span className="text-3xl font-extrabold text-amber-700">57</span>
                      <span className="text-xs font-semibold text-slate-500">/ 100</span>
                    </div>
                  </div>
                  <div className="relative w-14 h-14 flex items-center justify-center">
                    <svg className="w-14 h-14 transform -rotate-90" viewBox="0 0 36 36">
                      <path
                        className="text-slate-200"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3.5"
                      />
                      <path
                        className="text-amber-500"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke="currentColor"
                        strokeDasharray="57, 100"
                        strokeLinecap="round"
                        strokeWidth="3.5"
                      />
                    </svg>
                    <span className="absolute text-[10px] font-bold text-amber-800">57%</span>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-amber-200/60">
                  <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider block mb-1.5">
                    Historical Health Trend
                  </span>
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-600 bg-white/70 px-3 py-1.5 rounded-lg border border-amber-100">
                    <span className="text-slate-400">72</span>
                    <span className="text-slate-300">→</span>
                    <span className="text-slate-500">68</span>
                    <span className="text-slate-300">→</span>
                    <span className="text-amber-600">61</span>
                    <span className="text-slate-300">→</span>
                    <span className="text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded text-[11px] font-bold">
                      57
                    </span>
                  </div>
                </div>
              </div>

              {/* Risk Deduction Factors */}
              <div className="space-y-2">
                <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block">
                  Risk Deduction Factors
                </span>
                <div className="space-y-1.5 text-xs">
                  {DEDUCTIONS.map((deduction) => (
                    <div
                      key={deduction.label}
                      className={
                        "flex items-center justify-between p-2 rounded-lg border " + deduction.row
                      }
                    >
                      <div className="flex items-center space-x-2">
                        <span className={"w-1.5 h-1.5 rounded-full " + deduction.dot} />
                        <span className="font-medium text-slate-700">{deduction.label}</span>
                      </div>
                      <span className={"font-bold font-mono " + deduction.text}>{deduction.points}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recommended Action */}
              <div className="bg-indigo-50/70 border border-indigo-200 rounded-xl p-3.5 space-y-3">
                <div className="flex items-center space-x-1.5 text-indigo-900">
                  <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                    />
                  </svg>
                  <h3 className="text-xs font-bold uppercase tracking-wider">Recommended Action</h3>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed font-normal">
                  <strong className="font-semibold text-slate-900">Escalate to Sales Manager:</strong>{" "}
                  Deal has been inactive for 5 days and is waiting on revised commercial terms.
                </p>
                <div className="flex items-center space-x-2 pt-1">
                  <button
                    className={
                      "flex-1 px-3 py-2 text-white rounded-lg text-xs font-semibold shadow-sm transition-all duration-150 flex items-center justify-center space-x-1.5 " +
                      (escalated
                        ? "bg-emerald-600 hover:bg-emerald-700"
                        : "bg-indigo-600 hover:bg-indigo-700")
                    }
                    disabled={escalated}
                    onClick={() => {
                      setEscalated(true);
                      showToast("Escalation created for Acme Industries");
                    }}
                    type="button"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        d="M5 10l7-7m0 0l7 7m-7-7v18"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                      />
                    </svg>
                    <span>{escalated ? "Escalated" : "Escalate"}</span>
                  </button>
                  <button
                    className="px-3 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 rounded-lg text-xs font-medium transition-colors"
                    type="button"
                  >
                    Open Deal
                  </button>
                </div>
              </div>
            </div>
          </aside>
        </main>

        <StatusBar />

        {/* The toast is absolute inside the window, so it stays in here. */}
        <HealthToast />
      </AppWindow>

      <AppDock />

        <AgentButton />

    </AppShell>
  );
}

function FilterSelect({ options }: { options: string[] }) {
  return (
    <select
      className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      defaultValue={options[0]}
    >
      {options.map((option) => (
        <option key={option}>{option}</option>
      ))}
    </select>
  );
}

/** Sits inside the app window, top-right, rather than fixed to the viewport. */
function HealthToast() {
  const { message, visible } = useToastState();

  return (
    <div
      className={
        "absolute top-14 right-6 z-50 transition-all duration-300 transform " +
        (visible ? "opacity-100 translate-y-0" : "opacity-0 pointer-events-none translate-y-[-10px]")
      }
    >
      <div className="bg-slate-900 text-white text-xs font-medium px-4 py-2.5 rounded-lg shadow-xl flex items-center space-x-2 border border-slate-700">
        <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
        </svg>
        <span>{message || "Escalation created for Acme Industries"}</span>
      </div>
    </div>
  );
}
