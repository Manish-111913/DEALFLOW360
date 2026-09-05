"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  AppShell,
  AppWindow,
  StatusBar,
  WindowScroll,
} from "@/components/app-shell";
import { AppDock } from "@/components/app-dock";
import { DealAssistant } from "@/components/deal-assistant";
import { CHROME_BAR, PAGE_SUBTITLE, PAGE_TITLE, SCROLL_PADDING } from "@/components/design-tokens";
import { ToastProvider, useToast, useToastState } from "@/components/toast";
import { formatRupees, formatRupeesExact } from "@/lib/money";
import { ModifyDrawer } from "./modify-drawer";

/**
 * Screen 5 - Subscription & Billing, on live data.
 *
 * One-time lines, the recurring schedule and every upcoming period come from
 * `getBillingSchedule`. The proration wording is the service's own - it knows
 * how many days of the first cycle were covered - so the screen prints that
 * explanation instead of recomputing the fraction and risking a number that
 * disagrees with the invoice.
 */

export interface BillingLine {
  lineId: string;
  productName: string;
  quantity: number;
  lineTotal: string;
  taxAmount: string;
  invoiceId: string | null;
  invoiceStatus: string | null;
}

export interface BillingPeriod {
  periodStart: string;
  periodEnd: string;
  billingDate: string;
  amount: string;
  status: string;
  prorationNote: string | null;
}

export interface BillingSubscription {
  subscriptionId: string;
  productName: string;
  interval: string;
  quantity: number;
  unitPrice: string;
  status: string;
  upcoming: BillingPeriod[];
}

export interface BillingData {
  quotationId: string;
  quoteNumber: string;
  customerName: string;
  orderTotal: string;
  oneTime: BillingLine[];
  recurring: BillingSubscription[];
}

type Filter = "all" | "one-time" | "recurring";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All Billing" },
  { key: "one-time", label: "One-Time Only" },
  { key: "recurring", label: "Subscriptions Only" },
];

const INVOICE_BADGE: Record<string, string> = {
  ISSUED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  PAID: "bg-emerald-50 text-emerald-700 border-emerald-200",
  DRAFT: "bg-slate-100 text-slate-600 border-slate-200",
  CANCELLED: "bg-rose-50 text-rose-700 border-rose-200",
};

export function BillingClient({ data }: { data: BillingData | null }) {
  return (
    <ToastProvider durationMs={3200}>
      <Billing data={data} />
    </ToastProvider>
  );
}

function Billing({ data }: { data: BillingData | null }) {
  const router = useRouter();
  const showToast = useToast();
  const [filter, setFilter] = useState<Filter>("all");
  const [drawerFor, setDrawerFor] = useState<BillingSubscription | null>(null);
  const [cancelFor, setCancelFor] = useState<BillingSubscription | null>(null);
  const [busy, startTransition] = useTransition();

  const totals = useMemo(() => {
    if (!data) return { oneTime: 0, recurring: 0 };
    const oneTime = data.oneTime.reduce(
      (sum, line) => sum + Number(line.lineTotal) + Number(line.taxAmount),
      0,
    );
    const recurring = data.recurring.reduce(
      (sum, sub) => sum + Number(sub.unitPrice) * sub.quantity,
      0,
    );
    return { oneTime, recurring };
  }, [data]);

  function changeQuantity(subscription: BillingSubscription, quantity: number) {
    startTransition(async () => {
      const response = await fetch("/api/billing/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscriptionId: subscription.subscriptionId,
          action: "changeQuantity",
          quantity,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(body.error ?? "The quantity change was not applied");
        return;
      }
      setDrawerFor(null);
      showToast(`Quantity set to ${quantity}. Adjustment ${formatRupeesExact(body.delta ?? 0)}.`);
      router.refresh();
    });
  }

  function cancel(subscription: BillingSubscription, reason: string) {
    startTransition(async () => {
      const response = await fetch("/api/billing/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscriptionId: subscription.subscriptionId,
          action: "cancel",
          reason,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(body.error ?? "The cancellation was not recorded");
        return;
      }
      setCancelFor(null);
      showToast(
        body.creditNoteId
          ? `Cancelled. Credit note raised for ${formatRupeesExact(body.creditAmount ?? 0)}.`
          : "Cancellation recorded for the end of the current cycle.",
      );
      router.refresh();
    });
  }

  const showOneTime = filter === "all" || filter === "one-time";
  const showRecurring = filter === "all" || filter === "recurring";

  return (
    <AppShell className="screen-billing font-jakarta bg-[#f0f4f8] text-slate-800 selection:bg-indigo-100 selection:text-indigo-800">
      <AppWindow>
        <header className={CHROME_BAR}>
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-1.5">
              <span className="w-3 h-3 rounded-full bg-[#ff5f56] inline-block shadow-sm" />
              <span className="w-3 h-3 rounded-full bg-[#ffbd2e] inline-block shadow-sm" />
              <span className="w-3 h-3 rounded-full bg-[#27c93f] inline-block shadow-sm" />
            </div>
            <div className="h-4 w-px bg-slate-300" />
            <div className="text-xs font-medium text-slate-600">Sales Operations &amp; Billing</div>
          </div>
        </header>

        {data === null ? (
          <WindowScroll className={SCROLL_PADDING}>
            <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs p-8 text-center">
              <p className="text-sm font-bold text-slate-900">Nothing to bill yet</p>
              <p className="text-xs text-slate-500 mt-1">
                Billing appears once an order is confirmed and its lines are invoiced or a
                subscription is created.
              </p>
            </div>
          </WindowScroll>
        ) : (
          <>
            <section className="shrink-0 border-b border-slate-200/80 px-6 py-3.5 bg-white">
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
                    Manage one-time invoicing, line-item discounts, and recurring subscription
                    schedules for this order.
                  </p>
                </div>

                <div className="hidden lg:flex items-center space-x-2 px-3 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                  <span className="text-slate-500">Customer:</span>
                  <span className="font-semibold text-slate-800">{data.customerName}</span>
                  <span className="text-slate-300">|</span>
                  <span className="font-jetbrains text-indigo-600 font-medium">{data.quoteNumber}</span>
                </div>
              </div>
            </section>

            <section className="shrink-0 border-b border-slate-200/80 px-6 py-2.5 bg-slate-50/70">
              <div className="flex flex-wrap items-center justify-between gap-4 text-xs">
                <div className="flex flex-wrap items-center gap-6 divide-x divide-slate-200">
                  <Metric label="Order Value" value={formatRupees(data.orderTotal)} strong />
                  <Metric label="One-Time Total" value={formatRupees(totals.oneTime)} pad />
                  <Metric
                    label="Recurring Total"
                    value={`${formatRupees(totals.recurring)} / mo`}
                    indigo
                    pad
                  />
                  <Metric
                    label="Next Billing"
                    pad
                    value={
                      data.recurring[0]?.upcoming[0]
                        ? new Date(data.recurring[0].upcoming[0].billingDate).toLocaleDateString(
                            "en-GB",
                            { day: "2-digit", month: "short", year: "numeric" },
                          )
                        : "—"
                    }
                  />
                </div>

                <div className="flex items-center bg-white border border-slate-200 p-0.5 rounded-lg text-xs">
                  {FILTERS.map((option) => (
                    <button
                      className={
                        "px-2.5 py-1 rounded font-medium transition-colors " +
                        (filter === option.key
                          ? "bg-indigo-50 text-indigo-700 shadow-2xs"
                          : "text-slate-600 hover:text-slate-900")
                      }
                      key={option.key}
                      onClick={() => setFilter(option.key)}
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <WindowScroll className={SCROLL_PADDING}>
              {showOneTime && <OneTimeSection lines={data.oneTime} total={totals.oneTime} />}

              {showRecurring &&
                (data.recurring.length === 0 ? (
                  <section className="bg-white rounded-xl border border-slate-200/90 shadow-2xs p-6 text-center">
                    <p className="text-xs text-slate-500">
                      This order has no recurring lines. Subscriptions are created from products with
                      a billing plan behind them.
                    </p>
                  </section>
                ) : (
                  data.recurring.map((subscription) => (
                    <SubscriptionSection
                      busy={busy}
                      key={subscription.subscriptionId}
                      onCancel={() => setCancelFor(subscription)}
                      onModify={() => setDrawerFor(subscription)}
                      subscription={subscription}
                    />
                  ))
                ))}
            </WindowScroll>
          </>
        )}

        <StatusBar />
      </AppWindow>

      <AppDock />
      <DealAssistant
        quotationId={data?.quotationId ?? null}
        screen="billing"
        subject={data ? `${data.quoteNumber} - ${data.customerName}` : null}
      />
      <BillingToast />

      {drawerFor && (
        <ModifyDrawer
          busy={busy}
          currentQuantity={drawerFor.quantity}
          onClose={() => setDrawerFor(null)}
          onConfirm={(quantity) => changeQuantity(drawerFor, quantity)}
          productName={drawerFor.productName}
          unitPrice={Number(drawerFor.unitPrice)}
        />
      )}

      {cancelFor && (
        <CancelModal
          busy={busy}
          monthly={Number(cancelFor.unitPrice) * cancelFor.quantity}
          onClose={() => setCancelFor(null)}
          onConfirm={(reason) => cancel(cancelFor, reason)}
          productName={cancelFor.productName}
        />
      )}
    </AppShell>
  );
}

function Metric({
  label,
  value,
  strong,
  indigo,
  pad,
}: {
  label: string;
  value: string;
  strong?: boolean;
  indigo?: boolean;
  pad?: boolean;
}) {
  return (
    <div className={"flex items-center space-x-2 " + (pad ? "pl-6" : "")}>
      <span className="text-slate-500">{label}:</span>
      <span
        className={
          strong
            ? "font-bold text-slate-900 text-sm"
            : indigo
              ? "font-semibold text-indigo-700"
              : "font-semibold text-slate-800"
        }
      >
        {value}
      </span>
    </div>
  );
}

function OneTimeSection({ lines, total }: { lines: BillingLine[]; total: number }) {
  return (
    <section className="bg-white rounded-xl border border-slate-200/90 shadow-2xs overflow-hidden transition-all">
      <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between">
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-sm font-bold text-slate-900">One-Time Items</h2>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700">
              {lines.length} item{lines.length === 1 ? "" : "s"}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Physical hardware, setup services, and fixed costs billed once for this order.
          </p>
        </div>
        <div className="text-right">
          <span className="text-[11px] text-slate-500">Section Subtotal:</span>
          <span className="text-sm font-bold text-slate-900 ml-1.5">{formatRupeesExact(total)}</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50/75 border-b border-slate-100 text-slate-600 uppercase text-[10px] tracking-wider font-semibold">
            <tr>
              <th className="py-3 px-5">Product</th>
              <th className="py-3 px-4 text-center">Qty</th>
              <th className="py-3 px-4 text-right">Net</th>
              <th className="py-3 px-4 text-right">Tax</th>
              <th className="py-3 px-4 text-right">Total</th>
              <th className="py-3 px-4 text-center">Invoice Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-normal">
            {lines.length === 0 ? (
              <tr>
                <td className="py-6 px-5 text-center text-slate-500" colSpan={6}>
                  No one-time lines on this order.
                </td>
              </tr>
            ) : (
              lines.map((line) => (
                <tr className="hover:bg-slate-50/50 transition-colors" key={line.lineId}>
                  <td className="py-3.5 px-5">
                    <div className="font-semibold text-slate-900">{line.productName}</div>
                  </td>
                  <td className="py-3.5 px-4 text-center font-medium text-slate-800">
                    {line.quantity}
                  </td>
                  <td className="py-3.5 px-4 text-right text-slate-700">
                    {formatRupeesExact(line.lineTotal)}
                  </td>
                  <td className="py-3.5 px-4 text-right text-slate-600">
                    {formatRupeesExact(line.taxAmount)}
                  </td>
                  <td className="py-3.5 px-4 text-right font-bold text-slate-900">
                    {formatRupeesExact(Number(line.lineTotal) + Number(line.taxAmount))}
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <span
                      className={
                        "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border " +
                        (INVOICE_BADGE[line.invoiceStatus ?? ""] ??
                          "bg-amber-50 text-amber-700 border-amber-200")
                      }
                    >
                      {line.invoiceStatus ?? "Pending"}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SubscriptionSection({
  subscription,
  busy,
  onModify,
  onCancel,
}: {
  subscription: BillingSubscription;
  busy: boolean;
  onModify: () => void;
  onCancel: () => void;
}) {
  const monthly = Number(subscription.unitPrice) * subscription.quantity;

  return (
    <section className="bg-white rounded-xl border border-indigo-100 shadow-2xs overflow-hidden ring-1 ring-indigo-500/10">
      <div className="p-4 sm:p-5 border-b border-indigo-50 bg-indigo-50/30 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-sm font-bold text-slate-900">Recurring Subscriptions</h2>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-100 text-indigo-800">
              {subscription.status}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Ongoing licensing and SLA contracts, invoiced automatically each cycle.
          </p>
        </div>
      </div>

      <div className="p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200/80 gap-4 mb-5">
          <div className="flex items-start space-x-3.5">
            <div className="w-10 h-10 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold text-sm shrink-0 shadow-xs">
              {subscription.productName.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-bold text-slate-900 text-sm">{subscription.productName}</h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                  {subscription.interval}
                </span>
              </div>
              <div className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>
                  Unit Price: <strong>{formatRupees(subscription.unitPrice)}/seat</strong>
                </span>
                <span>
                  Quantity: <strong>{subscription.quantity} units</strong>
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between lg:justify-end space-x-4 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-200">
            <div className="text-right">
              <span className="text-[11px] text-slate-500 block">Recurring Amount</span>
              <span className="text-lg font-bold text-indigo-700">
                {formatRupees(monthly)}
                <span className="text-xs font-medium text-slate-500"> / mo</span>
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <button
                className="px-3 py-1.5 text-xs font-medium text-indigo-700 bg-white border border-indigo-200 hover:bg-indigo-50/80 rounded-lg shadow-2xs transition-colors disabled:opacity-60"
                disabled={busy || subscription.status !== "ACTIVE"}
                onClick={onModify}
                type="button"
              >
                Modify Quantity
              </button>
              <button
                className="px-3 py-1.5 text-xs font-medium text-rose-600 bg-white border border-rose-200 hover:bg-rose-50 rounded-lg shadow-2xs transition-colors disabled:opacity-60"
                disabled={busy || subscription.status !== "ACTIVE"}
                onClick={onCancel}
                type="button"
              >
                Cancel Plan
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-3.5">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Upcoming Billing Schedule
            </h4>
            <span className="text-[11px] text-slate-500">Next cycle runs automatically</span>
          </div>

          <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
            {subscription.upcoming.map((period, index) => (
              <div className="relative" key={period.billingDate + index}>
                <div
                  className={
                    "absolute -left-6 top-0.5 w-4 h-4 rounded-full ring-4 ring-white " +
                    (index === 0 ? "bg-indigo-600" : "bg-slate-300")
                  }
                />
                <div
                  className={
                    "flex items-start justify-between text-xs gap-3 " +
                    (index === 0
                      ? "bg-indigo-50/50 p-2 rounded-lg border border-indigo-100"
                      : "")
                  }
                >
                  <div>
                    <span
                      className={index === 0 ? "font-bold text-indigo-900" : "font-medium text-slate-700"}
                    >
                      {new Date(period.billingDate).toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}{" "}
                      — {period.status}
                    </span>
                    <span
                      className={
                        "block text-[11px] " + (index === 0 ? "text-indigo-700" : "text-slate-400")
                      }
                    >
                      {/* The service works out the proration; this is its wording. */}
                      {period.prorationNote ?? "Full standard billing cycle"}
                    </span>
                  </div>
                  <span
                    className={
                      "font-jetbrains shrink-0 " +
                      (index === 0 ? "font-bold text-indigo-900" : "text-slate-500")
                    }
                  >
                    {formatRupeesExact(period.amount)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function CancelModal({
  productName,
  monthly,
  busy,
  onClose,
  onConfirm,
}: {
  productName: string;
  monthly: number;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState(false);

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-200">
        <h3 className="text-sm font-bold text-slate-900 mb-1">Cancel {productName}?</h3>
        <p className="text-xs text-slate-500 mb-4 leading-relaxed">
          This terminates the recurring schedule of <strong>{formatRupees(monthly)}/month</strong> at
          the end of the current cycle. A credit note may be raised for unused time.
        </p>

        <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="cancel-reason">
          Reason (required)
        </label>
        <textarea
          className="w-full text-xs p-2.5 rounded-lg border border-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          id="cancel-reason"
          onChange={(event) => {
            setReason(event.target.value);
            if (problem) setProblem(false);
          }}
          placeholder="Why is this subscription being cancelled?"
          rows={3}
          value={reason}
        />
        {problem && (
          <p className="text-[11px] text-rose-600 mt-1 font-medium">
            A reason is required — the cancellation may raise a credit note.
          </p>
        )}

        <div className="flex items-center justify-end space-x-2.5 mt-4">
          <button
            className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            onClick={onClose}
            type="button"
          >
            Keep Subscription
          </button>
          <button
            className="px-3.5 py-2 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors disabled:opacity-60"
            disabled={busy}
            onClick={() => {
              if (!reason.trim()) {
                setProblem(true);
                return;
              }
              onConfirm(reason.trim());
            }}
            type="button"
          >
            {busy ? "Cancelling…" : "Confirm Cancellation"}
          </button>
        </div>
      </div>
    </div>
  );
}

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
      <span className="font-medium">{message}</span>
    </div>
  );
}
