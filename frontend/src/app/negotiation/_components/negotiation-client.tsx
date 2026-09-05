"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  AgentButton,
  AppShell,
  AppWindow,
  StatusBar,
  WindowScroll,
} from "@/components/app-shell";
import { AppDock } from "@/components/app-dock";
import { CHROME_BAR, PAGE_SUBTITLE, PAGE_TITLE, SCROLL_PADDING } from "@/components/design-tokens";
import { ROUTES } from "@/lib/navigation";
import { formatRupees } from "@/lib/money";
import { NegotiationModal } from "./negotiation-modal";

/**
 * Screen 6 - the Customer Negotiation Portal, on live data.
 *
 * Everything shown comes from the portal DTO, which is a whitelist (D20): it
 * carries lines, discounts and totals, and deliberately carries no margin, no
 * cost and no risk score. That is the reason the internal and portal views are
 * different objects rather than the same one with fields hidden in the markup -
 * a field that is not in the payload cannot leak from it.
 *
 * The status is read from the quotation rather than kept locally, so a counter
 * the seller has already answered shows the seller's answer and not the
 * optimistic one this screen guessed at.
 */

export interface PortalLine {
  lineId: string;
  productName: string;
  quantity: number;
  unitPrice: string;
  discountPercentage: string;
  lineTotal: string;
  taxAmount: string;
}

export interface PortalData {
  quotationId: string;
  quoteNumber: string;
  status: string;
  currency: string;
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  totalAmount: string;
  validUntil: string | null;
  awaitingSellerReview: boolean;
  lines: PortalLine[];
  conversation: {
    requests: {
      id: string;
      lineId: string | null;
      requestType: string;
      requestedValue: string | null;
      reason: string | null;
      status: string;
      createdAt: string;
    }[];
    comments: { id: string; lineId: string | null; message: string; createdAt: string }[];
  };
}

const STATUS_BADGE: Record<string, { style: string; dot: string; label: string }> = {
  NOT_SHARED: {
    style: "bg-slate-50 text-slate-600 border-slate-200",
    dot: "bg-slate-400",
    label: "Not shared",
  },
  SHARED: {
    style: "bg-indigo-50 text-indigo-700 border-indigo-200/80",
    dot: "bg-indigo-600 animate-pulse",
    label: "Sent",
  },
  UNDER_NEGOTIATION: {
    style: "bg-amber-50 text-amber-800 border-amber-300",
    dot: "bg-amber-500 animate-pulse",
    label: "Under Negotiation",
  },
  CONFIRMED: {
    style: "bg-emerald-50 text-emerald-800 border-emerald-300",
    dot: "bg-emerald-600",
    label: "Confirmed",
  },
};

export function NegotiationClient({
  data,
  internalNotice,
}: {
  data: PortalData | null;
  internalNotice: { role: string; sharedQuoteNumber: string | null; sharedCustomer: string | null } | null;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<PortalLine | "overall" | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, startTransition] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);

  function submitCounter(discount: number, reason: string, lineId: string | null) {
    if (!data) return;
    startTransition(async () => {
      const response = await fetch(`/api/portal/quotations/${data.quotationId}/negotiate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestType: "COUNTER_DISCOUNT",
          lineId,
          requestedValue: discount,
          reason,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setProblem(body.error ?? "That request could not be submitted.");
        return;
      }
      setTarget(null);
      setProblem(null);
      router.refresh();
    });
  }

  function confirm() {
    if (!data) return;
    startTransition(async () => {
      const response = await fetch(`/api/portal/quotations/${data.quotationId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setProblem(body.error ?? "The confirmation was not accepted.");
        return;
      }
      setConfirmOpen(false);
      router.refresh();
    });
  }

  const badge = data ? (STATUS_BADGE[data.status] ?? STATUS_BADGE.SHARED) : STATUS_BADGE.SHARED;
  const locked = data?.status === "CONFIRMED";

  return (
    <AppShell className="screen-portal font-jakarta bg-[#f0f4f8] text-slate-800 selection:bg-indigo-100 selection:text-indigo-900">
      <AppWindow>
        <header className={CHROME_BAR + " z-20"}>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 mr-2">
              <span className="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] inline-block" />
              <span className="w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#dea123] inline-block" />
              <span className="w-3 h-3 rounded-full bg-[#27c93f] border border-[#1aab29] inline-block" />
            </div>
            <div className="h-4 w-px bg-slate-200" />
            <span className="text-xs font-semibold text-slate-600">Customer Negotiation Portal</span>
          </div>
        </header>

        <WindowScroll className={SCROLL_PADDING + " bg-[#fafcff]"}>
          {internalNotice ? (
            <InternalNotice notice={internalNotice} />
          ) : data === null ? (
            <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs p-8 text-center">
              <p className="text-sm font-bold text-slate-900">No quotation has been shared with you</p>
              <p className="text-xs text-slate-500 mt-1">
                Your account manager will send a link when a quotation is ready to review.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-5 border-b border-slate-200/70">
                <div>
                  <div className="flex items-center gap-3">
                    <h1 className={PAGE_TITLE}>Commercial Quotation</h1>
                    <span
                      className={
                        "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border shadow-2xs " +
                        badge.style
                      }
                    >
                      <span className={"w-1.5 h-1.5 rounded-full " + badge.dot} />
                      {badge.label}
                    </span>
                  </div>
                  <p className={PAGE_SUBTITLE}>
                    Reference <span className="font-jetbrains">{data.quoteNumber}</span>
                    {data.validUntil
                      ? ` · valid until ${new Date(data.validUntil).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`
                      : ""}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg shadow-xs transition-colors disabled:opacity-60"
                    disabled={busy || locked}
                    onClick={() => setTarget("overall")}
                    type="button"
                  >
                    Propose Terms
                  </button>
                  <button
                    className={
                      "px-4 py-1.5 text-xs font-bold rounded-lg shadow-xs transition-colors disabled:opacity-60 " +
                      (locked
                        ? "bg-emerald-600 text-white cursor-default"
                        : "bg-indigo-600 hover:bg-indigo-700 text-white")
                    }
                    disabled={busy || locked}
                    onClick={() => setConfirmOpen(true)}
                    type="button"
                  >
                    {locked ? "Confirmed & Accepted" : "Confirm Quotation"}
                  </button>
                </div>
              </div>

              {problem && (
                <p className="text-[11px] text-rose-600 font-medium" role="alert">
                  {problem}
                </p>
              )}

              {data.awaitingSellerReview && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 shadow-2xs">
                  <h4 className="text-xs font-bold text-amber-900">
                    Your request is with the commercial desk
                  </h4>
                  <p className="text-xs text-amber-800 mt-0.5">
                    We will publish revised terms here as soon as they are approved.
                  </p>
                </div>
              )}

              {locked && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 shadow-2xs">
                  <h4 className="text-sm font-bold text-emerald-950">Quotation confirmed</h4>
                  <p className="text-xs text-emerald-800 mt-0.5">
                    Reference {data.quoteNumber} has been accepted. Your account manager will be in
                    touch about delivery.
                  </p>
                </div>
              )}

              {/* Totals - note there is no margin or cost here, by design */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Total label="Gross Subtotal" value={formatRupees(data.subtotal)} />
                <Total emerald label="Discount" value={"-" + formatRupees(data.discountAmount)} />
                <Total label="Taxes" value={formatRupees(data.taxAmount)} />
                <Total highlight label="Total Payable" value={formatRupees(data.totalAmount)} />
              </div>

              {/* Line items */}
              <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs overflow-hidden">
                <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">Quotation Line Items</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {data.lines.length} item{data.lines.length === 1 ? "" : "s"} · all figures in{" "}
                      {data.currency}
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-slate-50/75 border-b border-slate-100 text-slate-600 uppercase text-[10px] tracking-wider font-semibold">
                      <tr>
                        <th className="py-3 px-4">Item</th>
                        <th className="py-3 px-3 text-center">Qty</th>
                        <th className="py-3 px-4 text-right">Unit Price</th>
                        <th className="py-3 px-4 text-center">Discount</th>
                        <th className="py-3 px-4 text-right">Net Amount</th>
                        <th className="py-3 px-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.lines.map((line) => {
                        const pending = data.conversation.requests.find(
                          (request) => request.lineId === line.lineId && request.status === "PENDING",
                        );
                        return (
                          <tr className="hover:bg-slate-50/60 transition-colors" key={line.lineId}>
                            <td className="py-4 px-4">
                              <div className="font-bold text-slate-900 text-sm">
                                {line.productName}
                              </div>
                              {pending && (
                                <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 text-amber-800 border border-amber-200 text-xs font-medium">
                                  Change requested
                                  {pending.requestedValue ? `: ${pending.requestedValue}%` : ""}
                                </div>
                              )}
                            </td>
                            <td className="py-4 px-3 text-center font-semibold text-slate-700">
                              {line.quantity}
                            </td>
                            <td className="py-4 px-4 text-right text-slate-600 font-jetbrains">
                              {formatRupees(line.unitPrice)}
                            </td>
                            <td className="py-4 px-4 text-center">
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                                {line.discountPercentage}%
                              </span>
                            </td>
                            <td className="py-4 px-4 text-right font-bold text-slate-900 font-jetbrains text-sm">
                              {formatRupees(line.lineTotal)}
                            </td>
                            <td className="py-4 px-4 text-right">
                              <button
                                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-2.5 py-1.5 rounded-lg transition-colors border border-indigo-200/80 shadow-2xs disabled:opacity-50"
                                disabled={busy || locked}
                                onClick={() => setTarget(line)}
                                type="button"
                              >
                                Request Change
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* The customer-visible thread only */}
              {(data.conversation.requests.length > 0 || data.conversation.comments.length > 0) && (
                <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs p-5">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 mb-3">
                    Your requests
                  </h3>
                  <ul className="space-y-2 text-xs">
                    {data.conversation.requests.map((request) => (
                      <li
                        className="flex items-start justify-between gap-3 p-2.5 rounded-lg bg-slate-50 border border-slate-200/80"
                        key={request.id}
                      >
                        <div>
                          <span className="font-semibold text-slate-800">
                            {request.requestType.replace(/_/g, " ").toLowerCase()}
                            {request.requestedValue ? ` — ${request.requestedValue}%` : ""}
                          </span>
                          {request.reason && (
                            <p className="text-[11px] text-slate-500 mt-0.5">{request.reason}</p>
                          )}
                        </div>
                        <span className="text-[10px] font-bold text-slate-500 shrink-0">
                          {request.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </WindowScroll>

        <StatusBar />
      </AppWindow>

      <AppDock />
      <AgentButton />

      {target && data && (
        <NegotiationModal
          busy={busy}
          currentDiscount={target === "overall" ? null : Number(target.discountPercentage)}
          currentTotal={target === "overall" ? data.totalAmount : target.lineTotal}
          onClose={() => setTarget(null)}
          onSubmit={(discount, reason) =>
            submitCounter(discount, reason, target === "overall" ? null : target.lineId)
          }
          title={target === "overall" ? `Overall quotation ${data.quoteNumber}` : target.productName}
        />
      )}

      {confirmOpen && data && (
        <ConfirmModal
          busy={busy}
          onClose={() => setConfirmOpen(false)}
          onConfirm={confirm}
          total={data.totalAmount}
        />
      )}
    </AppShell>
  );
}

function InternalNotice({
  notice,
}: {
  notice: { role: string; sharedQuoteNumber: string | null; sharedCustomer: string | null };
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs p-8 text-center">
      <p className="text-sm font-bold text-slate-900">This is the customer&apos;s view</p>
      <p className="text-xs text-slate-500 mt-1 max-w-lg mx-auto leading-relaxed">
        You are signed in as {notice.role || "an internal user"}. The portal deliberately refuses
        internal identities — it serves a different, narrower payload than the internal screens, with
        no margin, cost or risk on it, so staff read the deal through the Sales Workspace instead.
      </p>
      {notice.sharedQuoteNumber && (
        <p className="text-xs text-slate-500 mt-3">
          {notice.sharedQuoteNumber} is currently shared with{" "}
          <strong className="text-slate-700">{notice.sharedCustomer}</strong>. They reach it through
          a single-use link issued from the quotation.
        </p>
      )}
      <Link
        className="inline-block mt-4 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-colors"
        href={ROUTES.sales}
      >
        Back to Sales Workspace
      </Link>
    </div>
  );
}

function Total({
  label,
  value,
  emerald,
  highlight,
}: {
  label: string;
  value: string;
  emerald?: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        "p-3.5 rounded-xl border shadow-2xs " +
        (highlight ? "bg-indigo-50/50 border-indigo-200/70" : "bg-white border-slate-200/80")
      }
    >
      <span
        className={
          "text-[11px] font-medium " + (highlight ? "text-indigo-900 font-bold" : "text-slate-500")
        }
      >
        {label}
      </span>
      <div
        className={
          "text-xl font-bold font-jetbrains mt-1 " +
          (highlight ? "text-indigo-700" : emerald ? "text-emerald-600" : "text-slate-900")
        }
      >
        {value}
      </div>
    </div>
  );
}

function ConfirmModal({
  total,
  busy,
  onClose,
  onConfirm,
}: {
  total: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 text-center">
        <h3 className="text-sm font-bold text-slate-900">Confirm this quotation?</h3>
        <p className="text-xs text-slate-600 mt-2 leading-relaxed">
          By confirming you accept the commercial proposal and the standard terms shown above. This
          is a legally binding electronic acceptance and is recorded in the audit log.
        </p>
        <div className="my-5 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs flex justify-between font-jetbrains font-bold text-slate-800">
          <span>Order Commercial Total:</span>
          <span className="text-indigo-600">{formatRupees(total)}</span>
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
            className="flex-1 py-2.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition shadow-md disabled:opacity-60"
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {busy ? "Confirming…" : "Confirm Quotation"}
          </button>
        </div>
      </div>
    </div>
  );
}
