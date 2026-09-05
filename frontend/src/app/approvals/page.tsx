"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import {
  AgentButton,
  AppShell,
  AppWindow,
  StatusBar,
  WindowScroll,
} from "@/components/app-shell";
import { displayTimeNow } from "@/lib/display-clock";
import {
  CHROME_BAR,
  PAGE_SUBTITLE,
  PAGE_TITLE,
  SCROLL_PADDING,
} from "@/components/design-tokens";
import { ROUTES } from "@/lib/navigation";
import { AppDock } from "@/components/app-dock";
import { DecisionPanel, type Decision } from "./_components/decision-panel";

/**
 * Screen 3 - Sales Operations & Discount Approval.
 *
 * One quotation under review, with the exception that triggered it, the risk
 * score behind it and the chain that has to clear it. The decision made in the
 * right-hand panel is reflected in two places elsewhere on the page - the badge
 * beside the title and step 1 of the approval chain - so it is held here.
 *
 * The "Sales Workspace" breadcrumb and the dock's Sales tile both used to
 * `alert("Navigating back to Sales Workspace...")`; both now navigate there.
 */

const AVATAR_URL =
  "https://lh3.googleusercontent.com/aida/AEtjO1XfkszIkApvl77h_LTVNLjGdQCQb4nwx5y3ygicXR7r7P3I28BE3zGmU8Y-XEndBsT1xBzRyhuermKR-9KG0N9rOk5CPnUnJdG-m9ttgMqoWFSYLQ9WhMvKzk7BIUwGgbCf_nm89rhS-8NWpgvlXUwfqmo2WFGVCtLowIgBqS4SiJpVXy7s1_Fitf1qZW4qDK4o6dLmTk1K2ZeVtyBvhsydNZODT-W5N-qzziHW8VypgTPbHvPtn7UdywU";

/** The header badge beside the page title, per decision. */
const HEADER_BADGE: Record<Decision, { style: string; dot: string; label: string; pulse: boolean }> = {
  pending: {
    style: "bg-amber-50 text-amber-700 border-amber-200/90",
    dot: "bg-amber-500",
    label: "Pending Approval",
    pulse: true,
  },
  approved: {
    style: "bg-emerald-50 text-emerald-700 border-emerald-200",
    dot: "bg-emerald-500",
    label: "Approved",
    pulse: false,
  },
  revision: {
    style: "bg-indigo-50 text-indigo-700 border-indigo-200",
    dot: "bg-indigo-500",
    label: "Under Revision",
    pulse: false,
  },
  rejected: {
    style: "bg-rose-50 text-rose-700 border-rose-200",
    dot: "bg-rose-500",
    label: "Rejected",
    pulse: false,
  },
};

/** Step 1 of the approval chain, per decision. */
const STEP_ONE: Record<Decision, { badge: string; label: string; indicator: string }> = {
  pending: {
    badge: "bg-amber-50 text-amber-700 border border-amber-200",
    label: "Pending Review",
    indicator: "bg-amber-500",
  },
  approved: {
    badge: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    label: "Approved ✓",
    indicator: "bg-emerald-600",
  },
  revision: {
    badge: "bg-indigo-50 text-indigo-700 border border-indigo-200",
    label: "Returned for Revision",
    indicator: "bg-amber-500",
  },
  rejected: {
    badge: "bg-rose-50 text-rose-700 border border-rose-200",
    label: "Rejected ✕",
    indicator: "bg-amber-500",
  },
};

const RISK_FACTORS = [
  {
    dot: "bg-rose-500",
    label: "Category discount violation:",
    labelWeight: "font-semibold",
    detail: "Setup Service exceeds configured 10% ceiling",
    points: "+20 pts",
    pointStyle: "text-rose-600",
  },
  {
    dot: "bg-amber-500",
    label: "Margin exposure:",
    labelWeight: "font-semibold",
    detail: "Blended deal margin lowered to 22.0%",
    points: "+10 pts",
    pointStyle: "text-amber-600",
  },
  {
    dot: "bg-slate-400",
    label: "Delivery SLA risk:",
    labelWeight: "font-medium",
    detail: "Enterprise hardware fulfillment SLA conditions",
    points: "+5 pts",
    pointStyle: "text-slate-600",
  },
  {
    dot: "bg-slate-400",
    label: "Repeated negotiation:",
    labelWeight: "font-medium",
    detail: "Customer requested second revision cycle",
    points: "+5 pts",
    pointStyle: "text-slate-600",
  },
  {
    dot: "bg-slate-400",
    label: "Multiple deviations:",
    labelWeight: "font-medium",
    detail: "Cumulative minor terms variance",
    points: "+4 pts",
    pointStyle: "text-slate-600",
  },
];

const AUDIT_HISTORY = [
  { entry: "Manager review requested", at: "10:26 AM", style: "" },
  {
    entry: "Exception detected by Rule Engine",
    at: "10:25 AM",
    style: "text-amber-700 font-semibold",
  },
  { entry: "Quotation submitted by Priya Sharma", at: "10:24 AM", style: "" },
];

export default function DiscountApprovalPage() {
  const [decision, setDecision] = useState<Decision>("pending");
  // Stamped on approval only, so there is nothing time-dependent to render on
  // the server and no hydration mismatch.
  const [approvedAt, setApprovedAt] = useState<string | null>(null);

  const badge = HEADER_BADGE[decision];
  const step = STEP_ONE[decision];

  function decide(next: Decision) {
    setDecision(next);
    if (next === "approved") setApprovedAt(displayTimeNow());
  }

  return (
    <AppShell className="screen-approvals font-inter bg-[#f1f5f9] text-slate-800 selection:bg-indigo-500 selection:text-white">
      <AppWindow>
        {/* Top Window Title Bar */}
        <header className={CHROME_BAR + " z-20"}>
          <div className="flex items-center gap-3 w-1/3 min-w-[240px]">
            <div className="flex items-center space-x-2">
              <span className="w-3 h-3 rounded-full bg-rose-500 border border-rose-600/30 inline-block shadow-xs" />
              <span className="w-3 h-3 rounded-full bg-amber-400 border border-amber-500/30 inline-block shadow-xs" />
              <span className="w-3 h-3 rounded-full bg-emerald-500 border border-emerald-600/30 inline-block shadow-xs" />
            </div>
            <div className="h-4 w-px bg-slate-200 mx-1" />
            <div className="flex items-center gap-1.5 text-xs text-slate-700 font-medium tracking-tight">
              <span className="truncate text-slate-600 font-medium">
                Sales Operations &amp; Discount Approval
              </span>
            </div>
          </div>

          {/* Center: Global Quick Search */}
          <div className="w-1/3 max-w-md hidden md:block">
            <div className="relative flex items-center">
              <svg
                className="w-3.5 h-3.5 absolute left-3 text-slate-400 pointer-events-none"
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
                className="w-full pl-8 pr-9 py-1.5 text-xs bg-slate-100/90 border border-slate-200 rounded-lg text-slate-700 placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-all shadow-inner"
                placeholder="Search quotation, client, SKU, or approval ID (⌘K)"
                readOnly
                type="text"
              />
              <span className="absolute right-2.5 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 bg-white border border-slate-200 rounded shadow-xs">
                ⌘K
              </span>
            </div>
          </div>

          {/* Right: Notifications & Current User Profile */}
          <div className="flex items-center justify-end gap-3 w-1/3 min-w-[220px]">
            <button
              className="relative p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
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
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-indigo-600 rounded-full ring-2 ring-white" />
            </button>
            <div className="h-4 w-px bg-slate-200" />
            <div className="flex items-center gap-2 pl-1 cursor-pointer group">
              <Image
                alt="Priya Sharma"
                className="w-7 h-7 rounded-full object-cover ring-2 ring-slate-100 shadow-xs"
                height={28}
                src={AVATAR_URL}
                unoptimized
                width={28}
              />
              <div className="flex flex-col text-left">
                <span className="text-xs font-semibold text-slate-800 leading-tight group-hover:text-indigo-600 transition-colors">
                  Priya Sharma
                </span>
                <span className="text-[10px] text-slate-400 font-medium leading-none">Sales Director</span>
              </div>
            </div>
          </div>
        </header>

        {/* Window Main Workspace Body */}
        <WindowScroll className={SCROLL_PADDING + " bg-slate-50/60"}>
          {/* Top Action & Navigation Breadcrumb Bar */}
          <section className="mb-5 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <Link
                  className="inline-flex items-center text-xs font-semibold text-indigo-600 hover:text-indigo-700 transition-colors group"
                  href={ROUTES.sales}
                >
                  <svg
                    className="w-3.5 h-3.5 mr-1 group-hover:-translate-x-0.5 transition-transform"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
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
                <span className="text-xs font-medium text-slate-500">Exception Review</span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className={PAGE_TITLE}>Discount Approval</h1>
                <span
                  className={
                    "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border shadow-xs " +
                    badge.style
                  }
                >
                  <span
                    className={
                      "w-1.5 h-1.5 rounded-full " + badge.dot + (badge.pulse ? " animate-pulse" : "")
                    }
                  />
                  {badge.label}
                </span>
              </div>
              <p className={PAGE_SUBTITLE}>
                Review pricing exceptions and approve quotation DF-2024-1082 before locking commercials.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs shadow-xs flex items-center gap-2">
                <span className="text-slate-400">Customer:</span>
                <span className="font-semibold text-slate-800">Acme Industries</span>
                <span className="text-slate-300 font-mono">·</span>
                <span className="font-mono text-indigo-600 font-medium">DF-2024-1082</span>
              </div>
              <div className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs shadow-xs flex items-center gap-2">
                <span className="text-slate-400">Owner:</span>
                <span className="font-semibold text-slate-800">Priya Sharma</span>
                <span className="text-slate-300 font-mono">·</span>
                <span className="text-amber-700 font-medium">Requires VP Signoff</span>
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* LEFT COLUMN */}
            <div className="lg:col-span-8 flex flex-col gap-5">
              {/* Card 1: Quotation Summary Overview */}
              <section className="bg-white rounded-xl border border-slate-200/90 shadow-2xs p-5">
                <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-3.5">
                    <div className="w-11 h-11 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-sm shadow-xs">
                      AC
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-slate-900 leading-tight">Acme Industries</h2>
                      <p className="text-xs text-slate-500">
                        Cloud Migration &amp; ERP Integration Service Agreement
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 block">
                      Quotation Value
                    </span>
                    <span className="text-2xl font-black text-slate-900 tracking-tight font-mono">₹8.40 L</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 pt-4">
                  <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-100">
                    <span className="text-[11px] text-slate-500 block mb-0.5 font-medium">Reference ID</span>
                    <span className="text-xs font-mono font-bold text-slate-800">DF-2024-1082</span>
                  </div>
                  <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-100">
                    <span className="text-[11px] text-slate-500 block mb-0.5 font-medium">Assigned Rep</span>
                    <span className="text-xs font-semibold text-slate-800">Priya Sharma</span>
                  </div>
                  <div className="p-3 bg-amber-50/70 rounded-xl border border-amber-200/60">
                    <span className="text-[11px] text-amber-800 font-medium block mb-0.5">
                      Discount Exception
                    </span>
                    <span className="text-xs font-bold text-amber-900">18% on Setup (Max 10%)</span>
                  </div>
                  <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-100">
                    <span className="text-[11px] text-slate-500 block mb-0.5 font-medium">
                      Estimated Margin
                    </span>
                    <span className="text-xs font-bold text-slate-900 font-mono">22.0%</span>
                  </div>
                </div>
              </section>

              {/* Card 2: Discount Review Table */}
              <section className="bg-white rounded-xl border border-slate-200/90 shadow-2xs overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-white">
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                      Discount Review
                    </h3>
                    <span className="px-2 py-0.5 text-[11px] font-semibold bg-rose-50 text-rose-600 border border-rose-200 rounded-md">
                      1 Exception Detected
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400">
                    Ruleset: West India Q3 Enterprise Standard
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-slate-50/75 border-b border-slate-100 text-slate-600 text-[10px] font-semibold uppercase tracking-wider">
                        <th className="py-3 px-4 font-semibold">Line Item / Service</th>
                        <th className="py-3 px-3 text-center font-semibold">Qty</th>
                        <th className="py-3 px-3 text-right font-semibold">Unit Price</th>
                        <th className="py-3 px-3 text-right font-semibold">Total</th>
                        <th className="py-3 px-3 text-center font-semibold">Applied Discount</th>
                        <th className="py-3 px-3 text-center font-semibold">Policy Limit</th>
                        <th className="py-3 px-4 text-right font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {/* Within limit */}
                      <tr className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">
                            Laptop Pro 16&quot; (M-Series Core)
                          </div>
                          <div className="text-[11px] text-slate-400">Hardware · SKU: HW-LP16-01</div>
                        </td>
                        <td className="py-3 px-3 text-center text-slate-600 font-mono">10</td>
                        <td className="py-3 px-3 text-right text-slate-600 font-mono">₹80,000</td>
                        <td className="py-3 px-3 text-right font-semibold text-slate-900 font-mono">₹8.00 L</td>
                        <td className="py-3 px-3 text-center font-semibold text-slate-700">12%</td>
                        <td className="py-3 px-3 text-center text-slate-500">Allowed 15%</td>
                        <td className="py-3 px-4 text-right">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Within limit
                          </span>
                        </td>
                      </tr>

                      {/* The exception */}
                      <tr className="bg-amber-50/40 hover:bg-amber-50/60 transition-colors border-l-4 border-l-amber-500">
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-slate-900 flex items-center gap-1.5">
                            Setup &amp; Migration Service
                            <svg className="w-4 h-4 text-amber-600 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                              <path
                                clipRule="evenodd"
                                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                                fillRule="evenodd"
                              />
                            </svg>
                          </div>
                          <div className="text-[11px] text-amber-800">
                            Professional Services · SKU: PS-MIG-04
                          </div>
                        </td>
                        <td className="py-3.5 px-3 text-center text-slate-600 font-mono">1</td>
                        <td className="py-3.5 px-3 text-right text-slate-600 font-mono">₹20,000</td>
                        <td className="py-3.5 px-3 text-right font-bold text-slate-900 font-mono">₹20,000</td>
                        <td className="py-3.5 px-3 text-center font-bold text-amber-700 bg-amber-100/80 rounded">
                          18%
                        </td>
                        <td className="py-3.5 px-3 text-center text-slate-500">Allowed 10%</td>
                        <td className="py-3.5 px-4 text-right">
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                            8% Over Ceiling
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="px-4 py-2.5 bg-slate-50/90 border-t border-slate-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1.5 text-[11px] text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                      />
                    </svg>
                    Setup Service discount exceeds regional manager delegation threshold (&gt;10%).
                  </span>
                  <span className="font-semibold text-slate-700 font-mono">
                    Subtotal: ₹8,20,000 (after applied discounts)
                  </span>
                </div>
              </section>

              {/* Card 3: Deal Risk Score */}
              <section className="bg-white border border-slate-200/90 shadow-2xs p-5 rounded-xl">
                <div className="flex items-center justify-between mb-3.5">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                      Deal Risk Score
                    </h3>
                    <p className="text-xs text-slate-500">
                      Automated risk assessment derived from pricing rules &amp; account telemetry
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-black text-slate-800 tracking-tight font-mono">
                      44<span className="text-xs font-medium text-slate-400"> / 100</span>
                    </span>
                    <span className="px-2.5 py-1 text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 rounded-md">
                      Medium Risk
                    </span>
                  </div>
                </div>

                <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden mb-4">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-amber-400 to-amber-500 transition-all duration-500"
                    style={{ width: "44%" }}
                  />
                </div>

                <h4 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2.5">
                  Why this deal was flagged (5 contributing factors)
                </h4>
                <div className="space-y-2">
                  {RISK_FACTORS.map((factor) => (
                    <div
                      key={factor.label}
                      className="p-2.5 bg-slate-50 rounded-lg border border-slate-100 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className={"w-1.5 h-1.5 rounded-full shrink-0 " + factor.dot} />
                        <span className={"text-slate-800 " + factor.labelWeight}>{factor.label}</span>
                        <span className="text-slate-500">{factor.detail}</span>
                      </div>
                      <span className={"font-bold font-mono " + factor.pointStyle}>{factor.points}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            {/* RIGHT COLUMN */}
            <div className="lg:col-span-4 flex flex-col gap-5">
              {/* Card 1: Reviewer Context Banner */}
              <section className="bg-gradient-to-br from-indigo-50/80 via-white to-white border border-indigo-100 p-4 shadow-2xs rounded-xl">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-indigo-600 text-white rounded-lg shadow-xs shrink-0 mt-0.5">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                      />
                    </svg>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                      Awaiting Sales Manager Review
                    </h4>
                    <p className="text-xs text-slate-600 mt-1">
                      Requested by <span className="font-semibold text-slate-800">Priya Sharma</span> · 24m ago
                    </p>
                    <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-indigo-100/70 rounded text-[11px] font-semibold text-indigo-800">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 animate-pulse" />
                      SLA: 4h 00m remaining
                    </div>
                  </div>
                </div>
              </section>

              <DecisionPanel decision={decision} onDecide={decide} />

              {/* Card 3: Approval Chain Timeline */}
              <section className="bg-white border border-slate-200/90 shadow-2xs p-5 rounded-xl">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 mb-4">
                  Approval Chain
                </h3>
                <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                  {/* Step 1: Sales Manager Review */}
                  <div className="relative">
                    <div
                      className={
                        "absolute -left-6 top-0 w-5 h-5 rounded-full text-white flex items-center justify-center ring-4 ring-white shadow-xs " +
                        step.indicator
                      }
                    >
                      {decision === "approved" ? (
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="3"
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      ) : (
                        <span className="w-2 h-2 bg-white rounded-full animate-ping" />
                      )}
                    </div>
                    <div className="pl-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-900">Step 1: Sales Manager</span>
                        <span className={"text-[10px] font-semibold px-2 py-0.5 rounded " + step.badge}>
                          {step.label}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">Assigned to: Sales Manager on duty</p>
                      <p className="text-[11px] text-slate-400 mt-1 font-mono">
                        {approvedAt ? "Approved: Today · " + approvedAt : "Submitted: Today · 10:26 AM"}
                      </p>
                    </div>
                  </div>

                  {/* Step 2: Finance Review (Conditional) */}
                  <div className="relative">
                    <div className="absolute -left-6 top-0 w-5 h-5 rounded-full bg-slate-300 text-white flex items-center justify-center ring-4 ring-white">
                      <span className="w-1.5 h-1.5 bg-slate-50 rounded-full" />
                    </div>
                    <div className="pl-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-700">Step 2: Finance Review</span>
                        <span className="text-[10px] font-medium px-2 py-0.5 bg-slate-100 text-slate-500 rounded">
                          Not Required
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Trigger threshold is ₹15L or margin &lt;20%
                      </p>
                    </div>
                  </div>
                </div>
              </section>

              {/* Card 4: Compact Audit History */}
              <section className="bg-white border border-slate-200/90 shadow-2xs p-4 rounded-xl">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 mb-3">
                  Approval History
                </h3>
                <ul className="space-y-2.5 text-xs">
                  {AUDIT_HISTORY.map((item) => (
                    <li key={item.entry} className="flex items-start justify-between text-slate-600 gap-2">
                      <span className={"truncate " + item.style}>{item.entry}</span>
                      <span className="text-[11px] text-slate-400 font-mono shrink-0">{item.at}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        </WindowScroll>

        <StatusBar />
      </AppWindow>

      <AppDock />

      <AgentButton />

    </AppShell>
  );
}
