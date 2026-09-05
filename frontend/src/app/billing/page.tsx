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
import { ToastProvider, useToast, useToastState } from "@/components/toast";
import { ROUTES } from "@/lib/navigation";
import {
  CHROME_BAR,
  PAGE_SUBTITLE,
  PAGE_TITLE,
  SCROLL_PADDING,
} from "@/components/design-tokens";
import { AppDock } from "@/components/app-dock";
import { formatIndian } from "./_components/indian-currency";
import { ModifyDrawer } from "./_components/modify-drawer";

/**
 * Screen 5 - Subscription & Billing.
 *
 * The hybrid order the brief describes: two one-time lines invoiced separately
 * from one monthly subscription, with the proration that mid-cycle start
 * produced spelled out beside the schedule.
 *
 * Its toast lives 3.2s rather than the 2.6s the other screens use, so the
 * provider is given that duration explicitly.
 */

type BillingFilter = "all" | "one-time" | "recurring";

const FILTERS: { key: BillingFilter; label: string }[] = [
  { key: "all", label: "All Billing" },
  { key: "one-time", label: "One-Time Only" },
  { key: "recurring", label: "Subscriptions Only" },
];

const SEAT_PRICE = 1_200;

export default function BillingPage() {
  return (
    <ToastProvider durationMs={3200}>
      <Billing />
    </ToastProvider>
  );
}

function Billing() {
  const showToast = useToast();
  const [filter, setFilter] = useState<BillingFilter>("all");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [seats, setSeats] = useState(10);

  const showOneTime = filter === "all" || filter === "one-time";
  const showRecurring = filter === "all" || filter === "recurring";

  return (
    <AppShell className="screen-billing font-jakarta bg-[#f0f4f8] text-slate-800 selection:bg-indigo-100 selection:text-indigo-800">
      <AppWindow>
        {/* Window frame */}
        <header className={CHROME_BAR}>
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-1.5">
              <span className="w-3 h-3 rounded-full bg-[#ff5f56] inline-block shadow-sm" />
              <span className="w-3 h-3 rounded-full bg-[#ffbd2e] inline-block shadow-sm" />
              <span className="w-3 h-3 rounded-full bg-[#27c93f] inline-block shadow-sm" />
            </div>
            <div className="h-4 w-px bg-slate-300" />
            <div className="text-xs font-medium text-slate-600 flex items-center space-x-1">
              <span>Sales Operations &amp; Billing</span>
            </div>
          </div>

          <div className="w-80 md:w-96">
            <div className="relative flex items-center">
              <svg className="w-4 h-4 absolute left-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                />
              </svg>
              <input
                className="w-full pl-9 pr-10 py-1.5 text-xs bg-slate-100 hover:bg-slate-200/70 focus:bg-white border-transparent focus:border-indigo-500 rounded-full transition-all text-slate-700 placeholder-slate-400 focus:ring-1 focus:ring-indigo-500"
                placeholder="Search order, SKU, invoice, or subscription (⌘K)"
                readOnly
                type="text"
              />
              <kbd className="absolute right-2.5 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 bg-white border border-slate-200 rounded shadow-xs">
                ⌘K
              </kbd>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <button className="relative p-1 text-slate-500 hover:text-slate-700 transition-colors" title="Notifications" type="button">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                />
              </svg>
              <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-rose-500 rounded-full" />
            </button>
            <div className="h-4 w-px bg-slate-200" />
            <div className="flex items-center space-x-2">
              <div className="w-7 h-7 rounded-full bg-slate-900 text-white font-semibold text-xs flex items-center justify-center ring-2 ring-indigo-500/20">
                PS
              </div>
              <div className="hidden sm:block text-left">
                <p className="text-xs font-bold text-slate-800 leading-tight">Priya Sharma</p>
                <p className="text-[10px] text-slate-500 leading-tight">Sales Director</p>
              </div>
            </div>
          </div>
        </header>

        {/* Page header */}
        <section className="border-b border-slate-200/80 px-6 py-3.5 bg-white shrink-0">
          <div className="text-[11px] text-slate-500 flex items-center space-x-1.5 mb-1.5">
            <Link className="hover:text-slate-700 cursor-pointer" href={ROUTES.home}>
              Home
            </Link>
            <span>›</span>
            <Link className="hover:text-slate-700 cursor-pointer" href={ROUTES.sales}>
              Sales
            </Link>
            <span>›</span>
            <span className="text-slate-800 font-medium">Subscription &amp; Billing</span>
          </div>

          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <div className="flex items-center space-x-2.5">
                <h1 className={PAGE_TITLE}>Subscription &amp; Billing</h1>
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5" />
                  Active Cycle
                </span>
              </div>
              <p className={PAGE_SUBTITLE}>
                Manage one-time invoicing, line-item discounts, and recurring subscription schedules for
                this order.
              </p>
            </div>

            <div className="flex items-center flex-wrap gap-2.5">
              <div className="hidden lg:flex items-center space-x-2 px-3 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                <span className="text-slate-500">Customer:</span>
                <span className="font-semibold text-slate-800">Acme Industries</span>
                <span className="text-slate-300">|</span>
                <span className="text-slate-500">Ref:</span>
                <span className="font-mono text-indigo-600 font-medium">DF-2024-1082</span>
                <span className="text-slate-300">|</span>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                  Partially Invoiced
                </span>
              </div>
              <Link
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg shadow-xs transition-colors flex items-center space-x-1"
                href={ROUTES.fulfillment}
              >
                <span>←</span>
                <span>Back to Order</span>
              </Link>
              <div className="relative inline-block">
                <button
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg shadow-xs transition-colors flex items-center space-x-1.5"
                  type="button"
                >
                  <span>Actions</span>
                  <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Quick summary strip */}
        <section className="bg-slate-50/70 border-b border-slate-200/80 px-6 py-2.5 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-4 text-xs">
            <div className="flex flex-wrap items-center gap-6 divide-x divide-slate-200">
              <div className="flex items-center space-x-2">
                <span className="text-slate-500">Order Value:</span>
                <span className="font-bold text-slate-900 text-sm">₹8.76L</span>
              </div>
              <div className="pl-6 flex items-center space-x-2">
                <span className="text-slate-500">One-Time Total:</span>
                <span className="font-semibold text-slate-800">₹7.56L</span>
              </div>
              <div className="pl-6 flex items-center space-x-2">
                <span className="text-slate-500">Recurring Total:</span>
                <span className="font-semibold text-indigo-700">
                  ₹{formatIndian(seats * SEAT_PRICE)} / mo
                </span>
              </div>
              <div className="pl-6 flex items-center space-x-2">
                <span className="text-slate-500">Next Billing:</span>
                <span className="font-medium text-slate-800">01 Oct 2026</span>
              </div>
              <div className="pl-6 flex items-center space-x-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="font-medium text-emerald-700">Billing Active</span>
              </div>
            </div>

            <div className="flex items-center bg-white border border-slate-200 p-0.5 rounded-lg text-xs">
              {FILTERS.map((option) => (
                <button
                  key={option.key}
                  className={
                    "px-2.5 py-1 rounded font-medium transition-colors " +
                    (filter === option.key
                      ? "bg-indigo-50 text-indigo-700 shadow-2xs"
                      : "text-slate-600 hover:text-slate-900")
                  }
                  onClick={() => setFilter(option.key)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Main scrollable content */}
        <WindowScroll className={SCROLL_PADDING}>
          {/* SECTION 1: ONE-TIME ITEMS */}
          {showOneTime && (
            <section className="bg-white rounded-xl border border-slate-200/90 shadow-2xs overflow-hidden transition-all">
              <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <div className="flex items-center space-x-2">
                    <h2 className="text-sm font-bold text-slate-900">One-Time Items</h2>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700">
                      2 items
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Physical hardware, setup services, and fixed costs billed once for this order.
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[11px] text-slate-500">Section Subtotal:</span>
                  <span className="text-sm font-bold text-slate-900 ml-1.5">₹7,20,400.00</span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50/75 border-b border-slate-100 text-slate-600 uppercase text-[10px] tracking-wider font-semibold">
                    <tr>
                      <th className="py-3 px-5">Product &amp; SKU</th>
                      <th className="py-3 px-4 text-center">Qty</th>
                      <th className="py-3 px-4 text-right">Unit Price</th>
                      <th className="py-3 px-4 text-right">Discount</th>
                      <th className="py-3 px-4 text-right">Tax</th>
                      <th className="py-3 px-4 text-right">Total Net</th>
                      <th className="py-3 px-4 text-center">Invoice Status</th>
                      <th className="py-3 px-5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-normal">
                    <tr className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-3.5 px-5">
                        <div className="font-semibold text-slate-900">Laptop Pro 16&quot; (M-Series Core)</div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          SKU: HW-LP16-01 · Standard Corporate Batch
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-center font-medium text-slate-800">10</td>
                      <td className="py-3.5 px-4 text-right font-medium text-slate-700">₹80,000</td>
                      <td className="py-3.5 px-4 text-right text-slate-600">12%</td>
                      <td className="py-3.5 px-4 text-right text-slate-600">₹96,000</td>
                      <td className="py-3.5 px-4 text-right font-bold text-slate-900">₹7,04,000</td>
                      <td className="py-3.5 px-4 text-center">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <svg className="w-3 h-3 mr-1 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
                          </svg>
                          Invoiced
                        </span>
                      </td>
                      <td className="py-3.5 px-5 text-right">
                        <button
                          className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:underline"
                          onClick={() => showToast("Opening invoice #INV-8821")}
                          type="button"
                        >
                          View Invoice #INV-8821
                        </button>
                      </td>
                    </tr>

                    <tr className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-3.5 px-5">
                        <div className="font-semibold text-slate-900">Setup &amp; Migration Service</div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          SKU: OS-MIG-04 · Dedicated Engineer Onsite
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-center font-medium text-slate-800">1</td>
                      <td className="py-3.5 px-4 text-right font-medium text-slate-700">₹20,000</td>
                      <td className="py-3.5 px-4 text-right text-slate-600">18%</td>
                      <td className="py-3.5 px-4 text-right text-slate-600">₹3,600</td>
                      <td className="py-3.5 px-4 text-right font-bold text-slate-900">₹16,400</td>
                      <td className="py-3.5 px-4 text-center">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                          Pending
                        </span>
                      </td>
                      <td className="py-3.5 px-5 text-right">
                        <button
                          className="px-2.5 py-1 text-xs font-medium rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-colors"
                          onClick={() => showToast("Invoice generated for Setup & Migration Service")}
                          type="button"
                        >
                          Generate Invoice
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="bg-slate-50/60 px-5 py-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
                <span className="text-slate-500">
                  2 line items billed to Acme Industries Accounts Payable
                </span>
                <span className="text-slate-700 font-medium">
                  One-Time Total: <strong className="text-slate-900 font-bold ml-1">₹7,20,400.00</strong>
                </span>
              </div>
            </section>
          )}

          {/* SECTION 2: RECURRING SUBSCRIPTIONS */}
          {showRecurring && (
            <section className="bg-white rounded-xl border border-indigo-100 shadow-2xs overflow-hidden ring-1 ring-indigo-500/10">
              <div className="p-4 sm:p-5 border-b border-indigo-50 bg-indigo-50/30 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="flex items-center space-x-2">
                    <h2 className="text-sm font-bold text-slate-900">Recurring Subscriptions</h2>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-100 text-indigo-800">
                      1 active schedule
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Ongoing SaaS licensing, SLA maintenance contracts, and automated invoicing intervals.
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5" />
                    Auto-Charge Active
                  </span>
                </div>
              </div>

              <div className="p-5">
                {/* Plan card */}
                <div className="flex flex-col lg:flex-row lg:items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200/80 gap-4 mb-5">
                  <div className="flex items-start space-x-3.5">
                    <div className="w-10 h-10 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold text-sm shrink-0 shadow-xs">
                      CO
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <h3 className="font-bold text-slate-900 text-sm">
                          Cloud Operations &amp; Maintenance (Monthly Plan)
                        </h3>
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                          Monthly
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span>
                          Unit Price: <strong>₹1,200/seat</strong>
                        </span>
                        <span>
                          Quantity: <strong>{seats} units</strong>
                        </span>
                        <span>
                          Frequency: <strong>Calendar Monthly (1st of month)</strong>
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between lg:justify-end space-x-4 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-200">
                    <div className="text-right">
                      <span className="text-[11px] text-slate-500 block">Recurring Amount</span>
                      <span className="text-lg font-extrabold text-indigo-700">
                        ₹{formatIndian(seats * SEAT_PRICE)}{" "}
                        <span className="text-xs font-medium text-slate-500">/ mo</span>
                      </span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        className="px-3 py-1.5 text-xs font-medium text-indigo-700 bg-white border border-indigo-200 hover:bg-indigo-50/80 rounded-lg shadow-2xs transition-colors"
                        onClick={() => setDrawerOpen(true)}
                        type="button"
                      >
                        Modify Quantity
                      </button>
                      <button
                        className="px-3 py-1.5 text-xs font-medium text-rose-600 bg-white border border-rose-200 hover:bg-rose-50 rounded-lg shadow-2xs transition-colors"
                        onClick={() => setCancelOpen(true)}
                        type="button"
                      >
                        Cancel Plan
                      </button>
                    </div>
                  </div>
                </div>

                {/* Schedule & proration */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                  <div className="lg:col-span-7 bg-white rounded-lg border border-slate-200 p-4">
                    <div className="flex items-center justify-between mb-3.5">
                      <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                        Upcoming Billing Schedule
                      </h4>
                      <span className="text-[11px] text-slate-500">Next cycle runs automatically</span>
                    </div>

                    <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                      {/* Past */}
                      <div className="relative">
                        <div className="absolute -left-6 top-0.5 w-4 h-4 rounded-full bg-emerald-500 ring-4 ring-white flex items-center justify-center">
                          <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
                          </svg>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <div>
                            <span className="font-semibold text-slate-800">15 Sep 2026 — Plan Initiated</span>
                            <span className="block text-[11px] text-slate-500">
                              Mid-cycle start (Prorated charge applied)
                            </span>
                          </div>
                          <span className="font-mono font-medium text-slate-700">₹6,400.00</span>
                        </div>
                      </div>

                      {/* Next */}
                      <div className="relative">
                        <div className="absolute -left-6 top-0.5 w-4 h-4 rounded-full bg-indigo-600 ring-4 ring-indigo-100 flex items-center justify-center">
                          <div className="w-1.5 h-1.5 bg-white rounded-full" />
                        </div>
                        <div className="flex items-center justify-between text-xs bg-indigo-50/50 p-2 rounded-lg border border-indigo-100">
                          <div>
                            <span className="font-bold text-indigo-900">
                              01 Oct 2026 — Next Recurring Invoice
                            </span>
                            <span className="block text-[11px] text-indigo-700">
                              Full standard calendar monthly billing cycle
                            </span>
                          </div>
                          <span className="font-mono font-bold text-indigo-900">₹12,000.00</span>
                        </div>
                      </div>

                      {/* Future */}
                      <ScheduledCycle date="01 Nov 2026" />
                      <ScheduledCycle date="01 Dec 2026" />
                    </div>
                  </div>

                  <div className="lg:col-span-5 bg-gradient-to-br from-slate-50 to-slate-100/70 rounded-lg border border-slate-200 p-4 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                          Proration Math Breakdown
                        </h4>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-100 text-indigo-800">
                          Formula SLA
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 leading-relaxed">
                        Your first invoice was prorated based on activation date: 15 Sep 2026.
                      </p>
                      <div className="my-3.5 p-3 bg-white rounded-lg border border-slate-200 text-xs space-y-2">
                        <div className="flex justify-between items-center text-slate-600">
                          <span>Base Monthly Price:</span>
                          <span className="font-semibold text-slate-800">₹12,000.00</span>
                        </div>
                        <div className="flex justify-between items-center text-slate-600">
                          <span>Cycle Coverage:</span>
                          <span className="font-semibold text-indigo-700">16 of 30 days</span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                          <div className="bg-indigo-600 h-1.5 rounded-full" style={{ width: "53.3%" }} />
                        </div>
                        <div className="flex justify-between items-center pt-1 border-t border-slate-100 font-bold text-slate-900">
                          <span>First Invoiced Charge:</span>
                          <span className="text-indigo-700">₹6,400.00</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-500 flex items-center space-x-1.5">
                      <svg className="w-4 h-4 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                        />
                      </svg>
                      <span>
                        Automated prorated credit adjustments apply upon mid-month seat change.
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* SECTION 3: ACCOUNTING & PAYMENT SUMMARY STRIP */}
          <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                <span>Total Invoiced</span>
                <span className="text-emerald-600 font-medium">Synced</span>
              </div>
              <div className="text-xl font-bold text-slate-900">₹7,04,000.00</div>
              <div className="text-[11px] text-slate-500 mt-1">Reflects 1 closed invoice (#INV-8821)</div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                <span>Total Paid</span>
                <span className="text-emerald-600 font-medium">NEFT / RTGS</span>
              </div>
              <div className="text-xl font-bold text-emerald-700">₹5,00,000.00</div>
              <div className="text-[11px] text-slate-500 mt-1">
                Verified on 16 Sep 2026 via HDFC Gateway
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-2xs flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-500 mb-1">Outstanding Balance</div>
                <div className="text-xl font-bold text-amber-700">₹2,04,000.00</div>
                <div className="text-[11px] text-slate-500 mt-1">Due within standard NET-30 terms</div>
              </div>
              <button
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-colors shrink-0"
                onClick={() => showToast("Payment collection initiated for ₹2,04,000.00")}
                type="button"
              >
                Collect Payment
              </button>
            </div>
          </section>
        </WindowScroll>

        <StatusBar />
      </AppWindow>

      <AppDock />

      <AgentButton />

      {drawerOpen && (
        <ModifyDrawer
          onClose={() => setDrawerOpen(false)}
          onConfirm={(next) => {
            setSeats(next);
            setDrawerOpen(false);
            showToast("Subscription Updated: Quantity set to " + next + " units");
          }}
        />
      )}

      {cancelOpen && (
        <CancelPlanModal
          onClose={() => setCancelOpen(false)}
          onConfirm={() => {
            setCancelOpen(false);
            showToast("Cancellation request submitted for 01 Oct 2026");
          }}
        />
      )}

      <BillingToast />
    </AppShell>
  );
}

function ScheduledCycle({ date }: { date: string }) {
  return (
    <div className="relative">
      <div className="absolute -left-6 top-0.5 w-4 h-4 rounded-full bg-slate-300 ring-4 ring-white" />
      <div className="flex items-center justify-between text-xs">
        <div>
          <span className="font-medium text-slate-700">{date} — Scheduled Cycle</span>
          <span className="block text-[11px] text-slate-400">Regular recurring fee</span>
        </div>
        <span className="font-mono text-slate-500">₹12,000.00</span>
      </div>
    </div>
  );
}

function CancelPlanModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4 transition-opacity">
      <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-200">
        <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mb-4">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
          </svg>
        </div>
        <h3 className="text-base font-bold text-slate-900 mb-1">
          Cancel Cloud Operations Subscription?
        </h3>
        <p className="text-xs text-slate-500 mb-4 leading-relaxed">
          This will terminate the recurring schedule of <strong>₹12,000/month</strong> for Acme
          Industries effective at the end of current cycle on <strong>01 Oct 2026</strong>.
        </p>
        <div className="flex items-center justify-end space-x-2.5">
          <button
            className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            onClick={onClose}
            type="button"
          >
            Keep Subscription
          </button>
          <button
            className="px-3.5 py-2 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors"
            onClick={onConfirm}
            type="button"
          >
            Confirm Cancellation
          </button>
        </div>
      </div>
    </div>
  );
}

/** Billing's toast drops in from the top-right, unlike the command centre's. */
function BillingToast() {
  const { message, visible } = useToastState();

  return (
    <div
      className={
        "fixed top-5 right-5 z-50 bg-slate-900 text-white text-xs px-4 py-3 rounded-xl shadow-2xl flex items-center space-x-3 transform transition-all duration-300 pointer-events-none " +
        (visible ? "" : "translate-y-[-100px] opacity-0")
      }
    >
      <span className="w-2 h-2 rounded-full bg-emerald-400" />
      <span className="font-medium">{message || "Subscription updated successfully"}</span>
    </div>
  );
}
