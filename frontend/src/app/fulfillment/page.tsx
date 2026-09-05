"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AgentButton,
  AppShell,
  AppWindow,
  StatusBar,
  WindowScroll,
} from "@/components/app-shell";
import { ROUTES } from "@/lib/navigation";
import {
  CHROME_BAR,
  PAGE_TITLE,
  SCROLL_PADDING,
} from "@/components/design-tokens";
import { AppDock } from "@/components/app-dock";
import { OverrideModal, TARGET_UNITS, type Allocation } from "./_components/override-modal";

/**
 * Screen 4 - Fulfillment & Warehouse Allocation.
 *
 * Three things can change what the page shows, and they are deliberately kept
 * separate because the source screen kept them separate:
 *
 *   scenario   Scenario A/B swaps the headline metrics and the split bar
 *              between 20-of-20 and 20-of-25 with five backordered.
 *   allocation The override dialog rewrites the per-depot rows, the legend and
 *              the split bar - but not the metrics.
 *   accepted   Accepting the split only changes the button and the status line.
 *
 * So the bar widths have two possible authors. Switching scenario resets them to
 * that scenario's shape and applying an override recomputes them from the units;
 * `bars` holds whichever spoke last, which is exactly how the original behaved.
 */

type Scenario = "full" | "backorder";

interface Bars {
  main: string;
  east: string;
}

const SCENARIO_BARS: Record<Scenario, Bars> = {
  full: { main: "60%", east: "40%" },
  backorder: { main: "48%", east: "32%" },
};

export default function FulfillmentPage() {
  const [scenario, setScenario] = useState<Scenario>("full");
  const [allocation, setAllocation] = useState<Allocation>({ main: 12, east: 8 });
  const [bars, setBars] = useState<Bars>(SCENARIO_BARS.full);
  const [modalOpen, setModalOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [override, setOverride] = useState<Allocation | null>(null);

  const backorder = scenario === "backorder";

  function switchScenario(next: Scenario) {
    setScenario(next);
    setBars(SCENARIO_BARS[next]);
  }

  function applyOverride(next: Allocation) {
    setAllocation(next);
    setOverride(next);
    setBars({
      main: Math.round((next.main / TARGET_UNITS) * 100) + "%",
      east: Math.round((next.east / TARGET_UNITS) * 100) + "%",
    });
    setModalOpen(false);
  }

  const mainPercent = Math.round((allocation.main / TARGET_UNITS) * 100);
  const eastPercent = Math.round((allocation.east / TARGET_UNITS) * 100);

  return (
    <AppShell className="screen-fulfillment font-jakarta bg-[#f0f4f8] text-slate-800 selection:bg-indigo-100 selection:text-indigo-800">
      <AppWindow>
        {/* TOP HEADER / WINDOW BAR */}
        <header className={CHROME_BAR}>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-[#ef4444] inline-block cursor-pointer hover:opacity-80 transition-opacity" />
              <span className="w-3 h-3 rounded-full bg-[#f59e0b] inline-block cursor-pointer hover:opacity-80 transition-opacity" />
              <span className="w-3 h-3 rounded-full bg-[#10b981] inline-block cursor-pointer hover:opacity-80 transition-opacity" />
            </div>
            <div className="h-4 w-[1px] bg-slate-200" />
            <span className="text-xs font-semibold text-slate-700 tracking-tight flex items-center gap-1.5">
              <span className="text-slate-600 font-medium">Sales Operations &amp; Fulfillment</span>
            </span>
          </div>

          {/* Center: Global Search Bar */}
          <div className="w-full max-w-md mx-4 hidden md:block">
            <div className="relative flex items-center">
              <svg
                className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                />
              </svg>
              <input
                className="w-full pl-9 pr-10 py-1.5 text-xs bg-slate-50 hover:bg-slate-100/80 focus:bg-white border border-slate-200 rounded-lg text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                placeholder="Search order, SKU, warehouse, or shipment ID (⌘K)"
                type="text"
              />
              <kbd className="absolute right-2.5 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 bg-white border border-slate-200 rounded shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
                ⌘K
              </kbd>
            </div>
          </div>

          {/* Right: User Avatar & Actions */}
          <div className="flex items-center gap-3">
            <button
              aria-label="Notifications"
              className="relative p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-50 transition-colors"
              type="button"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                />
              </svg>
              <span className="absolute top-1 right-1.5 w-2 h-2 bg-indigo-600 rounded-full ring-2 ring-white" />
            </button>
            <div className="h-5 w-[1px] bg-slate-200" />
            <div className="flex items-center gap-2.5 pl-1">
              <div className="w-7 h-7 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-xs shadow-sm overflow-hidden">
                <span className="text-[10px] font-semibold tracking-tight">PS</span>
              </div>
              <div className="hidden sm:block text-left">
                <div className="text-xs font-bold text-slate-800 leading-tight">Priya Sharma</div>
                <div className="text-[10px] text-slate-400 font-medium">Sales Director</div>
              </div>
            </div>
          </div>
        </header>

        {/* INNER CONTENT SCROLL CONTAINER */}
        <WindowScroll className={SCROLL_PADDING}>
          {/* Breadcrumbs & Header Actions */}
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400 mb-1.5">
                <Link
                  className="text-indigo-600 hover:text-indigo-700 transition-colors flex items-center gap-1 font-semibold"
                  href={ROUTES.sales}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      d="M10 19l-7-7m0 0l7-7m-7 7h18"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                    />
                  </svg>
                  Sales Workspace
                </Link>
                <span className="text-slate-300">/</span>
                <span className="text-slate-500">Fulfillment &amp; Warehouse Allocation</span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className={PAGE_TITLE}>Fulfillment &amp; Warehouse Allocation</h1>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5" />
                  Quotation Approved
                </span>
              </div>

              {/* Metadata row */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 mt-2">
                <span>
                  Customer: <strong className="text-slate-800 font-semibold">Acme Industries</strong>
                </span>
                <span className="text-slate-300">•</span>
                <span>
                  Ref:{" "}
                  <span className="font-mono text-indigo-600 font-semibold bg-indigo-50/80 px-1.5 py-0.5 rounded">
                    DF-2024-1082
                  </span>
                </span>
                <span className="text-slate-300">•</span>
                <span>
                  Commercial Value: <strong className="text-slate-900 font-bold">₹8.40 L</strong>
                </span>
                <span className="text-slate-300">•</span>
                <span className="text-emerald-700 font-semibold flex items-center gap-1">
                  <svg className="w-3.5 h-3.5 text-emerald-600" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      clipRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      fillRule="evenodd"
                    />
                  </svg>
                  Credit Limit Verified
                </span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 self-start lg:self-center shrink-0">
              <Link
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg shadow-xs transition-colors inline-flex items-center gap-1.5"
                href={ROUTES.sales}
              >
                <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    d="M10 19l-7-7m0 0l7-7m-7 7h18"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                  />
                </svg>
                Back to Sales Workspace
              </Link>
              <button
                className="px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg shadow-xs transition-colors inline-flex items-center gap-1.5"
                onClick={() => setModalOpen(true)}
                type="button"
              >
                <svg className="w-3.5 h-3.5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                  />
                </svg>
                Manual Override
              </button>
            </div>
          </div>

          {/* Compact Metrics Row */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 bg-white p-4 rounded-xl border border-slate-200/90 shadow-2xs">
            <div className="px-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Requested</p>
              <p className="text-xl font-bold text-slate-900 mt-1">
                {backorder ? 25 : 20} <span className="text-xs font-normal text-slate-500">units</span>
              </p>
            </div>
            <div className="px-2 border-l border-slate-100">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Allocated</p>
              <p
                className={
                  "text-xl font-bold mt-1 " + (backorder ? "text-amber-600" : "text-emerald-600")
                }
              >
                20{" "}
                <span
                  className={
                    "text-xs font-normal " + (backorder ? "text-amber-600" : "text-emerald-600")
                  }
                >
                  units ({backorder ? "80" : "100"}%)
                </span>
              </p>
            </div>
            <div className="px-2 border-l border-slate-100">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Backordered</p>
              <p className="text-xl font-bold text-slate-400 mt-1">
                {backorder ? (
                  <span className="text-amber-600 font-bold">5 units</span>
                ) : (
                  <>
                    0 <span className="text-xs font-normal text-slate-400">units</span>
                  </>
                )}
              </p>
            </div>
            <div className="px-2 border-l border-slate-100">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Shipments</p>
              <p className="text-xl font-bold text-slate-900 mt-1">
                2 <span className="text-xs font-normal text-slate-500">consignments</span>
              </p>
            </div>
            <div className="px-2 border-l border-slate-100">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Logistics Freight
              </p>
              <p className="text-xl font-bold text-indigo-700 mt-1 font-mono">
                ₹370 <span className="text-xs font-normal font-jakarta text-slate-400">est.</span>
              </p>
            </div>
          </div>

          {/* Two-Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Operational Column */}
            <section className="lg:col-span-8 flex flex-col gap-6">
              {/* Recommended Warehouse Allocation Card */}
              <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs overflow-hidden flex flex-col">
                <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-white">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-bold text-slate-900">
                        Recommended Warehouse Allocation
                      </h2>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-600 border border-indigo-200">
                        <svg className="w-3 h-3 mr-1 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
                          <path
                            clipRule="evenodd"
                            d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z"
                            fillRule="evenodd"
                          />
                        </svg>
                        Algorithm Optimized
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Suggested split based on real-time depot inventory, client proximity, and
                      consolidated route cost.
                    </p>
                  </div>
                  <div className="shrink-0">
                    <span className="text-[11px] font-semibold text-slate-500 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-md">
                      Ruleset: West Hub Priority
                    </span>
                  </div>
                </div>

                {/* Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50/75 border-b border-slate-100 text-slate-600 uppercase text-[10px] tracking-wider font-semibold">
                      <tr>
                        <th className="py-3 px-5" scope="col">Warehouse Depot</th>
                        <th className="py-3 px-4" scope="col">Available Stock</th>
                        <th className="py-3 px-4" scope="col">Allocated Qty</th>
                        <th className="py-3 px-4" scope="col">Shipments</th>
                        <th className="py-3 px-4" scope="col">Est. Freight</th>
                        <th className="py-3 px-5 text-right" scope="col">Fulfillment Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                      <DepotRow
                        code="WH1"
                        codeStyle="bg-indigo-50 text-indigo-600 border-indigo-100"
                        name="Main Warehouse (West Hub)"
                        location="Bhiwandi Logistics Hub · Zone W1"
                        available={12}
                        allocated={allocation.main}
                        allocatedStyle="text-indigo-700 bg-indigo-50 border-indigo-200"
                        freight="₹150"
                      />
                      <DepotRow
                        code="WH2"
                        codeStyle="bg-sky-50 text-sky-600 border-sky-100"
                        name="East Depot (Logistics Center)"
                        location="Kolkata Central Facility · Zone E2"
                        available={8}
                        allocated={allocation.east}
                        allocatedStyle="text-sky-700 bg-sky-50 border-sky-200"
                        freight="₹220"
                      />
                    </tbody>
                  </table>
                </div>

                {/* Allocation Split Progress */}
                <div className="p-5 bg-slate-50/60 border-t border-slate-100">
                  <div className="flex items-center justify-between text-xs font-semibold mb-2">
                    <span className="text-slate-700 flex items-center gap-1.5">
                      <span>Allocation Split Progress</span>
                      <span className="text-slate-400 font-normal">
                        {backorder
                          ? "(20 of 25 units assigned · 5 Backordered)"
                          : "(20 of 20 units assigned)"}
                      </span>
                    </span>
                    <span className="text-emerald-600 font-bold flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
                      </svg>
                      100% Fulfilled
                    </span>
                  </div>

                  <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden flex">
                    <div
                      className="bg-indigo-600 h-full transition-all duration-500 relative"
                      style={{ width: bars.main }}
                      title={"Main Warehouse: " + allocation.main + " units"}
                    />
                    <div
                      className="bg-sky-500 h-full transition-all duration-500 relative"
                      style={{ width: bars.east }}
                      title={"East Depot: " + allocation.east + " units"}
                    />
                    {backorder && (
                      <div
                        className="bg-amber-400 h-full transition-all duration-500 relative"
                        style={{ width: "20%" }}
                        title="Backordered: 5 units"
                      />
                    )}
                  </div>

                  <div className="flex items-center justify-between mt-2.5 text-[11px] text-slate-500">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-sm bg-indigo-600" />
                        <span>
                          Main Warehouse:{" "}
                          <strong className="text-slate-700">
                            {allocation.main} units ({mainPercent}%)
                          </strong>
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-sm bg-sky-500" />
                        <span>
                          East Depot:{" "}
                          <strong className="text-slate-700">
                            {allocation.east} units ({eastPercent}%)
                          </strong>
                        </span>
                      </div>
                      {backorder && (
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-sm bg-amber-400" />
                          <span className="text-amber-700 font-semibold">
                            Backordered: <strong>5 units (20%)</strong>
                          </span>
                        </div>
                      )}
                    </div>
                    <span className="font-mono text-slate-400">Freight Subtotal: ₹370</span>
                  </div>
                </div>

                {/* Action Bar Footer */}
                <div className="px-5 py-3.5 bg-white border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
                  <AcceptanceStatus accepted={accepted} override={override} />
                  <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                    <button
                      className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg shadow-sm transition-colors"
                      onClick={() => setModalOpen(true)}
                      type="button"
                    >
                      Manual Override
                    </button>
                    {accepted ? (
                      <button
                        className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 rounded-lg shadow-sm flex items-center gap-1.5 cursor-default"
                        disabled
                        type="button"
                      >
                        <svg className="w-3.5 h-3.5 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          />
                        </svg>
                        Allocation Confirmed
                      </button>
                    ) : (
                      <button
                        className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] rounded-lg shadow-sm transition-all flex items-center gap-1.5"
                        onClick={() => setAccepted(true)}
                        type="button"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
                        </svg>
                        Accept Suggested Split
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Order Items Breakdown */}
              <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs p-5">
                <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2.5">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Order Items Breakdown
                  </h3>
                  <span className="text-xs text-slate-400">3 SKU line items in quotation</span>
                </div>
                <div className="divide-y divide-slate-100">
                  <div className="py-3 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 font-mono text-[10px]">
                        HW
                      </div>
                      <div>
                        <span className="font-bold text-slate-800">Laptop Pro 16&quot; (M-Series Core)</span>
                        <span className="text-slate-400 block text-[11px]">
                          SKU: HW-LP16-01 · Unit Price: ₹80,000
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="font-bold text-slate-800">10 units</span>
                      <span className="text-[11px] text-indigo-600 block font-semibold">
                        Fulfilled from Main Warehouse
                      </span>
                    </div>
                  </div>

                  <div className="py-3 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-600 font-mono text-[10px]">
                        SRV
                      </div>
                      <div>
                        <span className="font-bold text-slate-800">Setup &amp; Migration Service</span>
                        <span className="text-slate-400 block text-[11px]">
                          SKU: PS-MIG-04 · Professional Services
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="font-bold text-slate-800">1 unit</span>
                      <span className="text-[11px] text-purple-600 block font-semibold">
                        Virtual / Cloud Delivery (N/A)
                      </span>
                    </div>
                  </div>

                  <div className="py-3 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 font-mono text-[10px]">
                        HW
                      </div>
                      <div>
                        <span className="font-bold text-slate-800">Enterprise Server Rackmount Units</span>
                        <span className="text-slate-400 block text-[11px]">
                          SKU: HW-SRV-2U · High Compute Storage
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="font-bold text-slate-800">9 units</span>
                      <span className="text-[11px] text-slate-500 block">
                        <span className="text-indigo-600 font-medium">Main WH: 2</span> ·{" "}
                        <span className="text-sky-600 font-medium">East Depot: 7</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Right Column */}
            <aside className="lg:col-span-4 flex flex-col gap-6">
              {/* Fulfillment Summary Card */}
              <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs p-5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Fulfillment Summary
                  </h3>
                  <span className="text-[10px] font-mono font-bold bg-slate-100 px-2 py-0.5 rounded text-slate-600">
                    DF-2024-1082
                  </span>
                </div>
                <dl className="space-y-2.5 text-xs">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Requested Physical Units</dt>
                    <dd className="font-bold text-slate-800">{backorder ? 25 : 20}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Total Allocated</dt>
                    <dd className="font-bold text-emerald-600">20</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Remaining Unallocated</dt>
                    <dd className={"font-bold " + (backorder ? "text-amber-600" : "text-slate-700")}>
                      {backorder ? "5 (Backordered)" : "0"}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Consolidated Consignments</dt>
                    <dd className="font-bold text-slate-800">2 Shipments</dd>
                  </div>
                  <div className="border-t border-slate-100 pt-2.5 flex justify-between items-center text-sm">
                    <dt className="font-bold text-slate-900">Total Freight Cost</dt>
                    <dd className="font-extrabold text-indigo-600 text-base font-mono">₹370</dd>
                  </div>
                </dl>
              </div>

              {/* Routing & Carrier Dispatch Card */}
              <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs p-5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-3.5 flex items-center justify-between">
                  <span>Routing &amp; Carrier Dispatch</span>
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                </h3>
                <div className="space-y-3">
                  <RouteNode
                    depot="Main Warehouse (West)"
                    carrier="BlueDart Air"
                    eta="24 hrs"
                    note="Direct air freight connection to Mumbai Commercial Hub"
                  />
                  <RouteNode
                    depot="East Depot (Kolkata)"
                    carrier="Delhivery Express"
                    eta="48 hrs"
                    note="Inter-depot linehaul with GPS sensor tag tracking"
                  />
                </div>
              </div>

              {/* Simulation & Testing Card */}
              <div className="bg-indigo-50/40 rounded-xl border border-indigo-100 p-5">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-900 flex items-center gap-1.5">
                    <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                      />
                    </svg>
                    Simulation &amp; Testing
                  </h4>
                  <span className="text-[10px] font-semibold text-indigo-600 bg-white px-1.5 py-0.5 rounded border border-indigo-200">
                    Interactive
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 mb-3">
                  Simulate customer order adjustments or inventory shortage scenarios live.
                </p>
                <div className="space-y-2">
                  <button
                    className={
                      "w-full text-left p-2.5 rounded-xl border text-xs font-semibold flex items-center justify-between transition-all " +
                      (scenario === "full"
                        ? "bg-white border-indigo-400 shadow-sm text-indigo-950"
                        : "bg-white/70 hover:bg-white border-slate-200 text-slate-700")
                    }
                    onClick={() => switchScenario("full")}
                    type="button"
                  >
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span>Scenario A: Full Allocation</span>
                    </span>
                    <span className="text-[10px] font-mono text-slate-500">20 / 20 Units</span>
                  </button>
                  <button
                    className={
                      "w-full text-left p-2.5 rounded-xl border text-xs font-semibold flex items-center justify-between transition-all " +
                      (scenario === "backorder"
                        ? "bg-white border-amber-400 shadow-sm text-amber-950"
                        : "bg-white/70 hover:bg-white border-slate-200 text-slate-700")
                    }
                    onClick={() => switchScenario("backorder")}
                    type="button"
                  >
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      <span>Scenario B: Partial Backorder</span>
                    </span>
                    <span className="text-[10px] font-mono text-slate-500">20 / 25 Units</span>
                  </button>
                </div>

                {/* Dynamic Backorder Notice Card */}
                {backorder && (
                  <div className="mt-3 p-3 bg-amber-50/90 border border-amber-200 rounded-xl">
                    <div className="flex items-start gap-2">
                      <svg className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          clipRule="evenodd"
                          d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                          fillRule="evenodd"
                        />
                      </svg>
                      <div>
                        <p className="text-xs font-bold text-amber-900">Backorder Notice: 5 Units Unfilled</p>
                        <p className="text-[11px] text-amber-700 mt-0.5">
                          5 Server Rackmount Units exceed current network inventory. Arrival expected in 4
                          days from Chennai Hub.
                        </p>
                        <button
                          className="mt-2 text-[11px] font-bold text-amber-900 hover:text-amber-950 underline flex items-center gap-1"
                          type="button"
                        >
                          Consolidate Remaining Backorder →
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </aside>
          </div>
        </WindowScroll>

        <StatusBar />
      </AppWindow>

      <AppDock />

      <AgentButton />

      {modalOpen && (
        <OverrideModal
          allocation={allocation}
          onApply={applyOverride}
          onClose={() => setModalOpen(false)}
        />
      )}
    </AppShell>
  );
}

function DepotRow({
  code,
  codeStyle,
  name,
  location,
  available,
  allocated,
  allocatedStyle,
  freight,
}: {
  code: string;
  codeStyle: string;
  name: string;
  location: string;
  available: number;
  allocated: number;
  allocatedStyle: string;
  freight: string;
}) {
  return (
    <tr className="hover:bg-slate-50/50 transition-colors">
      <td className="py-3.5 px-5">
        <div className="flex items-center gap-2.5">
          <div
            className={
              "w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs border " + codeStyle
            }
          >
            {code}
          </div>
          <div>
            <div className="font-bold text-slate-900 text-xs">{name}</div>
            <div className="text-[11px] text-slate-400">{location}</div>
          </div>
        </div>
      </td>
      <td className="py-3.5 px-4 text-slate-600">
        <span className="font-semibold text-slate-800">{available}</span> available
      </td>
      <td className="py-3.5 px-4">
        <span className={"font-bold border px-2 py-0.5 rounded " + allocatedStyle}>
          {allocated} allocated
        </span>
      </td>
      <td className="py-3.5 px-4 text-slate-600">1 consignment</td>
      <td className="py-3.5 px-4 font-mono font-bold text-slate-800">{freight}</td>
      <td className="py-3.5 px-5 text-right">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
          ● Allocated
        </span>
      </td>
    </tr>
  );
}

/**
 * The line above the action buttons. It has three states, in the same priority
 * the source used: accepting wins over an override, which wins over the default.
 */
function AcceptanceStatus({
  accepted,
  override,
}: {
  accepted: boolean;
  override: Allocation | null;
}) {
  if (accepted) {
    return (
      <div className="flex items-center gap-2 text-xs font-medium text-emerald-700 bg-emerald-50/80 px-3 py-1.5 rounded-lg border border-emerald-200">
        <svg className="w-4 h-4 text-emerald-600 shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path
            clipRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
            fillRule="evenodd"
          />
        </svg>
        <span className="text-emerald-800 font-bold">
          Consignments created with carriers BlueDart &amp; Delhivery. Dispatch manifests generated.
        </span>
      </div>
    );
  }

  if (override) {
    return (
      <div className="flex items-center gap-2 text-xs font-medium text-indigo-900 bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-200">
        <svg className="w-4 h-4 text-indigo-600 shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path
            clipRule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            fillRule="evenodd"
          />
        </svg>
        <span className="text-indigo-900 font-semibold">
          Custom allocation override applied ({override.main} WH1 / {override.east} WH2). Stock reserved.
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs font-medium text-emerald-700 bg-emerald-50/80 px-3 py-1.5 rounded-lg border border-emerald-200">
      <svg className="w-4 h-4 text-emerald-600 shrink-0" fill="currentColor" viewBox="0 0 20 20">
        <path
          clipRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
          fillRule="evenodd"
        />
      </svg>
      <span>Suggested allocation verified against SLA thresholds. Ready to reserve inventory.</span>
    </div>
  );
}

function RouteNode({
  depot,
  carrier,
  eta,
  note,
}: {
  depot: string;
  carrier: string;
  eta: string;
  note: string;
}) {
  return (
    <div className="p-3 bg-slate-50/80 border border-slate-200/70 rounded-xl relative">
      <div className="flex items-center justify-between mb-1">
        <span className="font-bold text-xs text-slate-900">{depot}</span>
        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100/60 px-1.5 py-0.5 rounded">
          Dispatch Ready
        </span>
      </div>
      <div className="text-[11px] text-slate-500 flex items-center justify-between">
        <span>
          Carrier: <strong className="text-slate-700">{carrier}</strong>
        </span>
        <span>
          ETA: <strong className="text-slate-800">{eta}</strong>
        </span>
      </div>
      <div className="text-[10px] text-slate-400 mt-1">{note}</div>
    </div>
  );
}
