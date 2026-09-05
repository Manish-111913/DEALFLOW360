"use client";

import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { ROUTES } from "@/lib/navigation";

/**
 * The four alert cards down the right of the workspace.
 *
 * In the source screen each button only raised a toast. Three of the four name
 * a destination that now exists - approvals, fulfilment, negotiation - so those
 * navigate as well as toasting. "Review Deals" has no screen of its own; it
 * still only toasts, as before.
 */

interface Alert {
  /** The coloured left edge that distinguishes each alert. */
  accent: string;
  title: string;
  action: string;
  body: string;
  toast: string;
  goTo?: string;
}

const ALERTS: Alert[] = [
  {
    accent: "border-amber-500",
    title: "4 quotations awaiting approval",
    action: "Review Approvals",
    body: "Beta Industries and NovaCorp have discount exceptions requiring manager review.",
    toast: "Navigating to Approvals page",
    goTo: ROUTES.approvals,
  },
  {
    accent: "border-rose-500",
    title: "3 stalled deals",
    action: "Review Deals",
    body: "Nova Systems and Zenith Retail have had no activity for more than the configured threshold.",
    toast: "Opening stalled deals review list",
  },
  {
    accent: "border-blue-600",
    title: "2 fulfillment backorders",
    action: "Inspect Queue",
    body: "Server rack components for Apex Global are currently delayed.",
    toast: "Opening Depot Fulfillment queue",
    goTo: ROUTES.fulfillment,
  },
  {
    accent: "border-indigo-600",
    title: "1 customer negotiation request",
    action: "View Redlines",
    body: "Acme Industries submitted revised commercial terms for review.",
    toast: "Opening Acme Industries redline viewer",
    goTo: ROUTES.negotiation,
  },
];

export function AttentionRequired() {
  const showToast = useToast();
  const router = useRouter();

  return (
    <div className="lg:col-span-4 bg-white border border-slate-200/90 rounded-xl shadow-2xs flex flex-col justify-between overflow-hidden">
      <div>
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-display text-sm font-bold text-slate-900">Attention Required</h2>
          <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-50 text-amber-700 rounded border border-amber-200">
            4 items
          </span>
        </div>

        {/* Alert Items with colored left borders */}
        <div className="divide-y divide-slate-100">
          {ALERTS.map((alert) => (
            <div
              key={alert.title}
              className={
                "p-4 sm:p-5 hover:bg-slate-50/70 transition-colors flex flex-col gap-2 border-l-[3.5px] " +
                alert.accent
              }
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900 leading-snug">{alert.title}</h3>
                <button
                  className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors shrink-0 shadow-2xs"
                  onClick={() => {
                    showToast(alert.toast);
                    if (alert.goTo) router.push(alert.goTo);
                  }}
                  type="button"
                >
                  {alert.action}
                </button>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">{alert.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Attention Required Footer Link */}
      <div className="p-4 sm:px-5 border-t border-slate-100 flex items-center justify-end bg-slate-50/40">
        <a
          className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1 transition-colors"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            showToast("Navigating to full operational activity log");
          }}
        >
          <span>View all activity</span>
          <span className="text-[13px]">→</span>
        </a>
      </div>
    </div>
  );
}
