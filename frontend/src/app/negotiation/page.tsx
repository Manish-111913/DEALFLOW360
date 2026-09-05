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
  PAGE_SUBTITLE,
  PAGE_TITLE,
  SCROLL_PADDING,
} from "@/components/design-tokens";
import { NegotiationModal, type NegotiationTarget } from "./_components/negotiation-modal";
import { AppDock } from "@/components/app-dock";

/**
 * Screen 6 - the Customer Negotiation Portal, seen as the customer.
 *
 * The screen has three states and they only move forwards:
 *
 *   sent        the quotation as issued
 *   negotiating a counter has been submitted; amber banner, "Pending Review"
 *   confirmed   accepted; emerald banner, buttons locked
 *
 * Both "Confirm Quotation" buttons and both banners follow that one value, so
 * it lives here. Which line the counter was raised against is tracked
 * separately, because the amber note appears on that row only.
 */

type Status = "sent" | "negotiating" | "confirmed";

const OVERALL_TARGET: NegotiationTarget = {
  title: "Overall Quotation DF-2024-1082",
  sku: "Commercial Terms",
  currentDiscount: 15,
  currentTotal: "₹8,50,072",
};

const LAPTOP_TARGET: NegotiationTarget = {
  title: 'Laptop Pro 16" (M-Series Core)',
  sku: "HW-LP16-01",
  currentDiscount: 12,
  currentTotal: "₹7,04,000",
};

const SERVICE_TARGET: NegotiationTarget = {
  title: "Setup & Migration Service",
  sku: "OS-MIG-04",
  currentDiscount: 18,
  currentTotal: "₹16,400",
};

export default function NegotiationPortalPage() {
  const [status, setStatus] = useState<Status>("sent");
  const [target, setTarget] = useState<NegotiationTarget | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [quotationsOpen, setQuotationsOpen] = useState(false);
  const [laptopFeedback, setLaptopFeedback] = useState(false);
  const [serviceFeedback, setServiceFeedback] = useState<string | null>(null);

  function submitNegotiation(discount: number) {
    // The source screen keyed off the word "Setup" in the item title, so a
    // counter on the overall quotation lands on the laptop row. Kept as-is.
    if (target?.title.includes("Setup")) {
      setServiceFeedback(
        "Change Request Under Review: " +
          (discount ? discount + "% proposed" : "Comment submitted"),
      );
    } else {
      setLaptopFeedback(true);
    }
    setTarget(null);
    setStatus("negotiating");
  }

  return (
    <AppShell className="screen-portal font-jakarta bg-[#f0f4f8] text-slate-800 selection:bg-indigo-100 selection:text-indigo-900">
      <AppWindow>
        {/* 1. WINDOW TOP HEADER BAR */}
        <header className={CHROME_BAR + " z-20"}>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 mr-2">
              <span className="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] inline-block shadow-2xs cursor-pointer" />
              <span className="w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#dea123] inline-block shadow-2xs cursor-pointer" />
              <span className="w-3 h-3 rounded-full bg-[#27c93f] border border-[#1aab29] inline-block shadow-2xs cursor-pointer" />
            </div>
            <div className="h-4 w-px bg-slate-200" />
            <div className="flex items-center gap-2.5 ml-1">
              <span className="text-xs font-semibold text-slate-600">Customer Negotiation Portal</span>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100/80">
                Acme Industries
              </span>
            </div>
          </div>

          <div className="hidden md:flex items-center">
            <div className="relative w-80 lg:w-96">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
                search
              </span>
              <input
                className="w-full bg-slate-50 border border-slate-200/90 rounded-xl pl-9 pr-12 py-1.5 text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition shadow-inner"
                placeholder="Search quotation, SKU, or negotiation (⌘K)"
                readOnly
                type="text"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono font-medium text-slate-400 bg-white px-1.5 py-0.5 rounded border border-slate-200 shadow-2xs">
                ⌘K
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition shadow-2xs"
              onClick={() => setQuotationsOpen(true)}
              type="button"
            >
              <span className="material-symbols-outlined text-sm text-slate-400">description</span>
              <span>Quotations</span>
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-600" />
            </button>
            <button
              className="relative w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-100 flex items-center justify-center transition"
              type="button"
            >
              <span className="material-symbols-outlined text-lg">notifications</span>
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white" />
            </button>
            <div className="h-5 w-px bg-slate-200" />
            <div className="flex items-center gap-2.5 pl-1 cursor-pointer">
              <div className="text-right hidden sm:block">
                <div className="text-xs font-semibold text-slate-900 leading-tight">Priya Mehta</div>
                <div className="text-[10px] text-slate-500">Client Authorized · Acme</div>
              </div>
              <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 font-bold text-xs flex items-center justify-center border border-indigo-200/80 shadow-inner">
                PM
              </div>
            </div>
          </div>
        </header>

        {/* 2. INNER WORKSPACE SCROLL CONTAINER */}
        <WindowScroll className={SCROLL_PADDING + " bg-[#fafcff]"}>
          {/* Breadcrumbs & Reference Tag */}
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3 text-xs">
            <div className="flex items-center gap-1.5 text-slate-500 font-medium">
              <Link className="hover:text-slate-800 cursor-pointer" href={ROUTES.home}>
                Home
              </Link>
              <span className="text-slate-300">›</span>
              <Link className="hover:text-slate-800 cursor-pointer" href={ROUTES.sales}>
                Sales
              </Link>
              <span className="text-slate-300">›</span>
              <span className="text-slate-900 font-semibold">Customer Negotiation Portal</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] font-semibold text-indigo-700 bg-indigo-50/80 border border-indigo-200/80 px-2.5 py-0.5 rounded-md">
                Ref: DF-2024-1082
              </span>
              <span className="text-slate-400 text-xs">·</span>
              <span className="text-slate-500 text-xs">Revision v1.2</span>
            </div>
          </div>

          {/* Page Title & Header Actions Row */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-5 border-b border-slate-200/70">
            <div>
              <div className="flex items-center gap-3">
                <h1 className={PAGE_TITLE}>Customer Negotiation Portal</h1>
                <StatusBadge status={status} />
              </div>
              <p className={PAGE_SUBTITLE}>
                Review customer commercial terms, line-item counter discounts, and commercial acceptance
                for Acme Industries.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {/* In the source screen this button opened the quotations list
                  rather than navigating, despite its label. Kept as drawn. */}
              <button
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg shadow-xs transition-colors flex items-center gap-1.5"
                onClick={() => setQuotationsOpen(true)}
                type="button"
              >
                <span className="material-symbols-outlined text-sm text-slate-400">arrow_back</span>
                <span>Sales Workspace</span>
              </button>
              <button
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg shadow-xs transition-colors flex items-center gap-1.5"
                onClick={() => setTarget(OVERALL_TARGET)}
                type="button"
              >
                <span className="material-symbols-outlined text-sm text-indigo-600">tune</span>
                <span>Propose Terms</span>
              </button>
              <ConfirmButton
                onClick={() => setConfirmOpen(true)}
                status={status}
                variant="top"
              />
            </div>
          </div>

          {/* DYNAMIC STATUS BANNERS */}
          {status === "negotiating" && (
            <div className="my-4 bg-amber-50 border border-amber-200 rounded-xl p-4 shadow-2xs transition-all duration-200">
              <div className="flex items-start gap-3.5">
                <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center text-amber-700 flex-shrink-0 mt-0.5">
                  <span className="material-symbols-outlined text-base">hourglass_top</span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-amber-900">
                      Quotation is Currently Under Commercial Review
                    </h4>
                    <span className="text-[10px] font-semibold text-amber-800 bg-amber-100 px-2 py-0.5 rounded">
                      Submitted Just Now
                    </span>
                  </div>
                  <p className="text-xs text-amber-800 mt-0.5">
                    Your counter proposal and line item feedback have been submitted to the seller&apos;s
                    commercial deal desk. You will be notified as soon as revised terms are published.
                  </p>
                </div>
              </div>
            </div>
          )}

          {status === "confirmed" && (
            <div className="my-4 bg-emerald-50 border border-emerald-200 rounded-xl p-4 shadow-2xs transition-all duration-200">
              <div className="flex items-center gap-3.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-600 flex-shrink-0">
                  <span className="material-symbols-outlined text-xl">verified</span>
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-bold text-emerald-950">
                    Quotation Confirmed Successfully!
                  </h4>
                  <p className="text-xs text-emerald-800 mt-0.5">
                    Thank you, Priya! Reference <strong>DF-2024-1082</strong> has been accepted. A legally
                    signed PDF copy of the finalized agreement has been generated and dispatched.
                  </p>
                </div>
                <button
                  className="px-3 py-1.5 bg-white border border-emerald-300 text-emerald-800 rounded-lg text-xs font-semibold hover:bg-emerald-50 transition shadow-2xs flex items-center gap-1"
                  onClick={() => window.print()}
                  type="button"
                >
                  <span className="material-symbols-outlined text-xs">download</span>
                  Download PDF
                </button>
              </div>
            </div>
          )}

          {/* COMPACT KPI / SUMMARY STRIP */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 my-5">
            <KpiCard
              label="Gross Value"
              icon="receipt_long"
              value="₹8,20,000"
              note="2 billable items"
            />
            <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-emerald-700">Negotiated Discount</span>
                <span className="material-symbols-outlined text-emerald-600 text-sm">trending_down</span>
              </div>
              <div className="text-xl font-bold text-emerald-600 font-mono mt-1">-₹99,600</div>
              <div className="text-[10px] text-emerald-600/80 mt-0.5">Avg 14.2% reduction</div>
            </div>
            <KpiCard
              label="Taxes (GST 18%)"
              icon="account_balance"
              value="₹1,29,672"
              note="IGST applicable"
            />
            <div className="bg-indigo-50/50 p-3.5 rounded-xl border border-indigo-200/70 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-indigo-900">Total Payable</span>
                <span className="material-symbols-outlined text-indigo-600 text-sm">payments</span>
              </div>
              <div className="text-xl font-bold text-indigo-700 font-mono mt-1">₹8,50,072</div>
              <div className="text-[10px] text-indigo-600 mt-0.5">All taxes included</div>
            </div>
            <div className="col-span-2 md:col-span-1 bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-slate-500">Quotation Status</span>
                <span className="material-symbols-outlined text-slate-400 text-sm">flag</span>
              </div>
              <div className="flex items-center gap-1.5 mt-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-xs font-bold text-slate-800">Active · Firm</span>
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">Valid until 20 Sep 2026</div>
            </div>
          </div>

          {/* MAIN QUOTATION CARD */}
          <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs overflow-hidden mb-6">
            <div className="p-5 md:p-6 border-b border-slate-100 bg-white">
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                      Commercial Quotation
                    </h2>
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                      Ref: DF-2024-1082
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Formally issued by DealFlow360 Commercial Services on behalf of Global Cloud Tech Ltd.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 text-xs">
                  <div className="bg-slate-50 border border-slate-200/80 rounded-lg px-3 py-1.5">
                    <span className="text-slate-400 block text-[9px] uppercase font-bold tracking-wider">
                      Issued To
                    </span>
                    <span className="font-bold text-slate-900 text-xs">Acme Industries</span>
                  </div>
                  <div className="bg-slate-50 border border-slate-200/80 rounded-lg px-3 py-1.5">
                    <span className="text-slate-400 block text-[9px] uppercase font-bold tracking-wider">
                      Issue Date
                    </span>
                    <span className="font-semibold text-slate-700 text-xs">05 Sep 2026</span>
                  </div>
                  <div className="bg-indigo-50/60 border border-indigo-200/80 rounded-lg px-3 py-1.5">
                    <span className="text-indigo-500 block text-[9px] uppercase font-bold tracking-wider">
                      Valid Until
                    </span>
                    <span className="font-bold text-indigo-900 text-xs">20 Sep 2026</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3.5 border-t border-slate-100 flex items-start gap-3 bg-slate-50/80 p-3.5 rounded-xl border border-slate-200/60">
                <span className="material-symbols-outlined text-indigo-600 text-base mt-0.5">info</span>
                <div className="text-xs text-slate-600 leading-relaxed">
                  <span className="font-bold text-slate-800">Hello Priya,</span> please review the formal
                  commercial terms prepared for Acme Industries below. You can accept the terms directly or
                  request line-item adjustments and propose counter discounts on each scope item.
                </div>
              </div>
            </div>

            {/* MAIN QUOTATION LINE ITEMS SECTION */}
            <div className="p-5 md:p-6">
              <div className="flex items-center justify-between mb-3.5">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900">Quotation Line Items</h3>
                  <span className="text-[11px] text-slate-400">(2 items included)</span>
                </div>
                <span className="text-[11px] text-slate-500 font-medium">
                  All figures quoted in Indian Rupee (₹)
                </span>
              </div>

              {/* DESKTOP / TABLET LINE ITEMS TABLE */}
              <div className="hidden sm:block overflow-x-auto border border-slate-200/90 rounded-xl shadow-2xs">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/75 border-b border-slate-100 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">
                      <th className="py-3 px-4">Item &amp; Description</th>
                      <th className="py-3 px-3 text-center">Qty</th>
                      <th className="py-3 px-4 text-right">Unit Price</th>
                      <th className="py-3 px-4 text-center">Applied Discount</th>
                      <th className="py-3 px-4 text-right">Net Amount</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    <tr className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-4 px-4">
                        <div className="font-bold text-slate-900 text-sm">
                          Laptop Pro 16&quot; (M-Series Core)
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          Enterprise hardware bundle · SKU: HW-LP16-01
                        </div>
                        {laptopFeedback && (
                          <LineFeedback text="Change Request Submitted: Counter 15% discount proposed" />
                        )}
                      </td>
                      <td className="py-4 px-3 text-center font-semibold text-slate-700">10</td>
                      <td className="py-4 px-4 text-right text-slate-600 font-mono">₹80,000</td>
                      <td className="py-4 px-4 text-center">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                          12%
                        </span>
                      </td>
                      <td className="py-4 px-4 text-right font-bold text-slate-900 font-mono text-sm">
                        ₹7,04,000
                      </td>
                      <td className="py-4 px-4 text-right">
                        <RequestChangeButton onClick={() => setTarget(LAPTOP_TARGET)} />
                      </td>
                    </tr>

                    <tr className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-4 px-4">
                        <div className="font-bold text-slate-900 text-sm">Setup &amp; Migration Service</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          Dedicated Onsite Migration &amp; ERP Integration · SKU: OS-MIG-04
                        </div>
                        {serviceFeedback && <LineFeedback text={serviceFeedback} />}
                      </td>
                      <td className="py-4 px-3 text-center font-semibold text-slate-700">1</td>
                      <td className="py-4 px-4 text-right text-slate-600 font-mono">₹20,000</td>
                      <td className="py-4 px-4 text-center">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                          18%
                        </span>
                      </td>
                      <td className="py-4 px-4 text-right font-bold text-slate-900 font-mono text-sm">
                        ₹16,400
                      </td>
                      <td className="py-4 px-4 text-right">
                        <RequestChangeButton onClick={() => setTarget(SERVICE_TARGET)} />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* MOBILE STACKED CARDS */}
              <div className="sm:hidden space-y-3">
                <MobileLine
                  title='Laptop Pro 16"'
                  meta="Qty: 10 · Unit: ₹80,000"
                  discount="12% Off"
                  total="₹7,04,000"
                  onRequest={() => setTarget(LAPTOP_TARGET)}
                />
                <MobileLine
                  title="Setup & Migration Service"
                  meta="Qty: 1 · Unit: ₹20,000"
                  discount="18% Off"
                  total="₹16,400"
                  onRequest={() => setTarget(SERVICE_TARGET)}
                />
              </div>

              {/* RECURRING CONTRACT ATTACHMENT NOTICE */}
              <div className="mt-4 p-3.5 rounded-xl bg-indigo-50/50 border border-indigo-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shadow-2xs">
                    SaaS
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900">
                      Attached Recurring Service: Cloud Operations &amp; Maintenance
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Billed monthly at ₹12,000/mo (10 user seats) beginning 01 Oct 2026
                    </div>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-white text-indigo-700 border border-indigo-200/80 shadow-2xs">
                  <span className="material-symbols-outlined text-xs">verified_user</span>
                  Standard SLA Attached
                </span>
              </div>

              {/* FINANCIAL SUMMARY BREAKDOWN */}
              <div className="mt-6 pt-5 border-t border-slate-100 flex flex-col lg:flex-row lg:items-start justify-between gap-6">
                <div className="text-xs text-slate-500 max-w-md space-y-1.5">
                  <div className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-slate-400 text-sm">gavel</span>
                    Commercial Notes &amp; Framework Terms:
                  </div>
                  <p>1. Pricing reflects custom commercial volume terms negotiated for Q3.</p>
                  <p>2. Hardware delivery lead-time: 24–48 hours from dispatch authorization.</p>
                  <p>3. Quotation validity remains firm until 20 September 2026.</p>
                  <p className="text-[11px] text-slate-400 pt-1">
                    Audited via DealFlow360 Cryptographic Ledger · Non-repudiation Hash: 0x9f4a...83c
                  </p>
                </div>

                <div className="w-full lg:w-84 bg-slate-50/90 rounded-xl p-4 border border-slate-200/80 space-y-2.5 shadow-2xs">
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>Gross Subtotal:</span>
                    <span className="font-mono font-medium text-slate-900">₹8,20,000</span>
                  </div>
                  <div className="flex justify-between text-xs text-emerald-700">
                    <span className="flex items-center gap-1">
                      <span>Negotiated Discount:</span>
                    </span>
                    <span className="font-mono font-semibold">-₹99,600</span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>Taxes (GST 18%):</span>
                    <span className="font-mono font-medium text-slate-900">₹1,29,672</span>
                  </div>
                  <div className="h-px bg-slate-200 my-1" />
                  <div className="flex justify-between items-baseline pt-0.5">
                    <span className="text-sm font-bold text-slate-900">Total Payable:</span>
                    <span className="text-xl font-extrabold text-slate-900 font-mono tracking-tight">
                      ₹8,50,072
                    </span>
                  </div>
                  <div className="text-[10px] text-right text-slate-500">
                    Including all applicable taxes &amp; freight charges
                  </div>
                </div>
              </div>
            </div>

            {/* CARD FOOTER ACTIONS */}
            <div className="p-4 md:p-5 bg-slate-50/80 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-xs text-slate-500 text-center sm:text-left">
                <span className="material-symbols-outlined text-slate-400 text-sm flex-shrink-0">
                  shield
                </span>
                <span>Legally binding electronic acceptance backed by DealFlow360 audit logs.</span>
              </div>
              <div className="flex items-center gap-2.5 w-full sm:w-auto">
                <button
                  className="flex-1 sm:flex-none px-4 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition shadow-2xs"
                  onClick={() => setTarget(OVERALL_TARGET)}
                  type="button"
                >
                  Propose Terms
                </button>
                <ConfirmButton
                  onClick={() => setConfirmOpen(true)}
                  status={status}
                  variant="footer"
                />
              </div>
            </div>
          </div>
        </WindowScroll>

        <StatusBar />
      </AppWindow>

      <AppDock />

      <AgentButton />

      {target && (
        <NegotiationModal
          key={target.sku}
          onClose={() => setTarget(null)}
          onSubmit={submitNegotiation}
          target={target}
        />
      )}

      {confirmOpen && (
        <ConfirmationModal
          onClose={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            setStatus("confirmed");
          }}
        />
      )}

      {quotationsOpen && <MyQuotationsModal onClose={() => setQuotationsOpen(false)} status={status} />}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

const STATUS_BADGES: Record<Status, { style: string; dot: string; label: string }> = {
  sent: {
    style: "bg-indigo-50 text-indigo-700 border-indigo-200/80",
    dot: "bg-indigo-600 animate-pulse",
    label: "Sent",
  },
  negotiating: {
    style: "bg-amber-50 text-amber-800 border-amber-300",
    dot: "bg-amber-500 animate-pulse",
    label: "Under Negotiation",
  },
  confirmed: {
    style: "bg-emerald-50 text-emerald-800 border-emerald-300",
    dot: "bg-emerald-600",
    label: "Confirmed",
  },
};

function StatusBadge({ status }: { status: Status }) {
  const badge = STATUS_BADGES[status];
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border shadow-2xs " +
        badge.style
      }
    >
      <span className={"w-1.5 h-1.5 rounded-full " + badge.dot} />
      {badge.label}
    </span>
  );
}

/**
 * "Confirm Quotation" appears twice - in the header and in the card footer -
 * with slightly different padding and a shorter confirmed label at the top.
 */
function ConfirmButton({
  status,
  variant,
  onClick,
}: {
  status: Status;
  variant: "top" | "footer";
  onClick: () => void;
}) {
  const top = variant === "top";

  if (status === "confirmed") {
    return (
      <button
        className={
          "text-xs font-bold text-white bg-emerald-600 rounded-xl cursor-default flex items-center gap-1.5 shadow-sm " +
          (top ? "px-4 py-2" : "px-5 py-2 justify-center")
        }
        disabled
        type="button"
      >
        <span className="material-symbols-outlined text-sm">verified</span>
        {top ? "Confirmed" : "Confirmed & Accepted"}
      </button>
    );
  }

  if (status === "negotiating") {
    return (
      <button
        className={
          "text-xs font-bold text-white bg-slate-700 hover:bg-slate-800 rounded-xl transition shadow-md shadow-indigo-200 flex items-center gap-1.5 " +
          (top ? "px-4 py-2" : "flex-1 sm:flex-none px-5 py-2 justify-center")
        }
        onClick={onClick}
        type="button"
      >
        Pending Review
      </button>
    );
  }

  return (
    <button
      className={
        "text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 rounded-xl transition shadow-md flex items-center gap-1.5 " +
        (top ? "px-4 py-2 shadow-indigo-200/80" : "flex-1 sm:flex-none px-5 py-2 justify-center shadow-indigo-200")
      }
      onClick={onClick}
      type="button"
    >
      <span className="material-symbols-outlined text-sm">check_circle</span>
      <span>Confirm Quotation</span>
    </button>
  );
}

function LineFeedback({ text }: { text: string }) {
  return (
    <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 text-amber-800 border border-amber-200 text-xs font-medium">
      <span className="material-symbols-outlined text-sm text-amber-600">sync_alt</span>
      <span>{text}</span>
    </div>
  );
}

function RequestChangeButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-2.5 py-1.5 rounded-lg transition-colors border border-indigo-200/80 shadow-2xs"
      onClick={onClick}
      type="button"
    >
      <span className="material-symbols-outlined text-xs">edit_note</span>
      Request Change
    </button>
  );
}

function KpiCard({
  label,
  icon,
  value,
  note,
}: {
  label: string;
  icon: string;
  value: string;
  note: string;
}) {
  return (
    <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-2xs">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-slate-500">{label}</span>
        <span className="material-symbols-outlined text-slate-400 text-sm">{icon}</span>
      </div>
      <div className="text-xl font-bold text-slate-900 font-mono mt-1">{value}</div>
      <div className="text-[10px] text-slate-400 mt-0.5">{note}</div>
    </div>
  );
}

function MobileLine({
  title,
  meta,
  discount,
  total,
  onRequest,
}: {
  title: string;
  meta: string;
  discount: string;
  total: string;
  onRequest: () => void;
}) {
  return (
    <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50">
      <div className="flex justify-between items-start">
        <div>
          <h4 className="font-bold text-slate-900 text-sm">{title}</h4>
          <p className="text-[11px] text-slate-500">{meta}</p>
        </div>
        <span className="text-xs font-bold bg-slate-200/80 px-2 py-0.5 rounded text-slate-700">
          {discount}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between pt-2 border-t border-slate-200">
        <span className="text-base font-extrabold text-slate-900 font-mono">{total}</span>
        <button
          className="text-xs font-semibold text-indigo-600 bg-white border border-indigo-200 px-3 py-1 rounded-lg shadow-2xs"
          onClick={onRequest}
          type="button"
        >
          Request Change
        </button>
      </div>
    </div>
  );
}

function ConfirmationModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 text-center">
        <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-4 border border-indigo-100">
          <span className="material-symbols-outlined text-2xl">verified</span>
        </div>
        <h3 className="text-base font-bold text-slate-900">Confirm this quotation?</h3>
        <p className="text-xs text-slate-600 mt-2 leading-relaxed">
          By confirming, you accept the commercial proposal and the standard terms shown above for{" "}
          <strong>Acme Industries</strong> (Ref: DF-2024-1082).
        </p>
        <div className="my-5 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs flex justify-between font-mono font-bold text-slate-800">
          <span>Order Commercial Total:</span>
          <span className="text-indigo-600">₹8,50,072</span>
        </div>
        <div className="flex items-center justify-center gap-3">
          <button
            className="flex-1 py-2.5 text-xs font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition"
            onClick={onClose}
            type="button"
          >
            Review Again
          </button>
          <button
            className="flex-1 py-2.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition shadow-md shadow-indigo-200"
            onClick={onConfirm}
            type="button"
          >
            Confirm Quotation
          </button>
        </div>
      </div>
    </div>
  );
}

function MyQuotationsModal({ onClose, status }: { onClose: () => void; status: Status }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h3 className="text-base font-bold text-slate-900">My Quotations</h3>
            <p className="text-xs text-slate-500">Commercial proposals issued to Acme Industries</p>
          </div>
          <button className="text-slate-400 hover:text-slate-600 p-1" onClick={onClose} type="button">
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>

        <div className="py-4 space-y-3">
          {/* Quote 1 (Current) */}
          <div className="p-3.5 rounded-xl border border-indigo-200 bg-indigo-50/40 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs text-slate-900">DF-2024-1082</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-100 text-indigo-700">
                  {status === "confirmed"
                    ? "Confirmed"
                    : status === "negotiating"
                      ? "Under Negotiation"
                      : "Sent (Active)"}
                </span>
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Laptop Pro 16&quot; &amp; Onsite Migration · ₹8.5L
              </div>
            </div>
            <button className="text-xs font-bold text-indigo-600 hover:underline" onClick={onClose} type="button">
              Viewing
            </button>
          </div>

          <ArchivedQuote
            reference="DF-2024-1075"
            badge="Confirmed"
            badgeStyle="bg-emerald-100 text-emerald-700"
            detail="Cloud Infra Support Q2 · ₹4.2L"
          />
          <ArchivedQuote
            reference="DF-2024-1068"
            badge="Sent"
            badgeStyle="bg-slate-100 text-slate-600"
            detail="Annual Dev Workstations · ₹2.8L"
          />
        </div>

        <div className="pt-3 border-t border-slate-100 text-right">
          <button
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function ArchivedQuote({
  reference,
  badge,
  badgeStyle,
  detail,
}: {
  reference: string;
  badge: string;
  badgeStyle: string;
  detail: string;
}) {
  return (
    <div className="p-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition flex items-center justify-between">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-bold text-xs text-slate-900">{reference}</span>
          <span className={"text-[10px] font-bold px-2 py-0.5 rounded " + badgeStyle}>{badge}</span>
        </div>
        <div className="text-[11px] text-slate-500 mt-0.5">{detail}</div>
      </div>
      <button className="text-xs font-semibold text-slate-600 hover:text-indigo-600" type="button">
        View
      </button>
    </div>
  );
}
