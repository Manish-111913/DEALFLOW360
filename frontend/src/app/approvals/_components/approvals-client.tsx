"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AppShell, AppWindow, StatusBar } from "@/components/app-shell";
import { AppDock } from "@/components/app-dock";
import { DealAssistant } from "@/components/deal-assistant";
import { CHROME_BAR, PAGE_SUBTITLE, PAGE_TITLE, SCROLL_PADDING } from "@/components/design-tokens";
import { WindowScroll } from "@/components/app-shell";
import { ROUTES } from "@/lib/navigation";
import { formatRupees } from "@/lib/money";
import type { ApprovalScreenData, QueueEntry } from "./types";

/**
 * Screen 3, on live data.
 *
 * Everything here is the quotation the server loaded: the exception table is
 * the real lines with their real ceilings, the risk breakdown is the engine's
 * own factors (D22 has each one explain itself, so the screen prints the
 * explanation rather than inventing a label), and the chain is the configured
 * approval steps.
 *
 * Deciding posts to /api/approvals/decide and then refreshes the server
 * component, so the badge, the chain and the queue all reflect the write rather
 * than being patched locally and drifting.
 */

const STATE_BADGE: Record<string, { style: string; dot: string; label: string; pulse: boolean }> = {
  NONE: {
    style: "bg-slate-50 text-slate-700 border-slate-200",
    dot: "bg-slate-400",
    label: "No approval required",
    pulse: false,
  },
  PENDING_MANAGER: {
    style: "bg-amber-50 text-amber-700 border-amber-200/90",
    dot: "bg-amber-500",
    label: "Pending Manager",
    pulse: true,
  },
  PENDING_FINANCE: {
    style: "bg-amber-50 text-amber-700 border-amber-200/90",
    dot: "bg-amber-500",
    label: "Pending Finance",
    pulse: true,
  },
  APPROVED: {
    style: "bg-emerald-50 text-emerald-700 border-emerald-200",
    dot: "bg-emerald-500",
    label: "Approved",
    pulse: false,
  },
  REJECTED: {
    style: "bg-rose-50 text-rose-700 border-rose-200",
    dot: "bg-rose-500",
    label: "Rejected",
    pulse: false,
  },
  RETURNED: {
    style: "bg-indigo-50 text-indigo-700 border-indigo-200",
    dot: "bg-indigo-500",
    label: "Returned for revision",
    pulse: false,
  },
};

/** How each risk source is coloured; the text itself comes from the engine. */
const FACTOR_TONE: Record<string, { dot: string; points: string }> = {
  CATEGORY_VIOLATION: { dot: "bg-rose-500", points: "text-rose-600" },
  MARGIN_EXPOSURE: { dot: "bg-amber-500", points: "text-amber-600" },
  DEVIATION_BREADTH: { dot: "bg-slate-400", points: "text-slate-600" },
  REPEATED_NEGOTIATION: { dot: "bg-slate-400", points: "text-slate-600" },
  DELIVERY_RISK: { dot: "bg-slate-400", points: "text-slate-600" },
};

const REQUEST_BADGE: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-700 border border-amber-200",
  APPROVED: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  REJECTED: "bg-rose-50 text-rose-700 border border-rose-200",
  RETURNED: "bg-indigo-50 text-indigo-700 border border-indigo-200",
};

type Decision = "APPROVE" | "REJECT" | "RETURN";

export function ApprovalsClient({
  data,
  queue,
}: {
  data: ApprovalScreenData | null;
  queue: QueueEntry[];
}) {
  const router = useRouter();
  const [collecting, setCollecting] = useState<"REJECT" | "RETURN" | null>(null);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const pendingRequest = data?.requests.find((request) => request.status === "PENDING") ?? null;
  const settled = data !== null && pendingRequest === null;

  function decide(decision: Decision) {
    if (!pendingRequest) return;
    if (decision !== "APPROVE" && !reason.trim()) {
      setProblem("Please enter a note before confirming this action.");
      return;
    }

    startTransition(async () => {
      const response = await fetch("/api/approvals/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: pendingRequest.id,
          decision,
          reason: reason.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setProblem(body.error ?? "The decision could not be recorded.");
        return;
      }

      setCollecting(null);
      setReason("");
      setProblem(null);
      // The write changed the quotation, the chain and the queue, so re-render
      // the server component rather than patching this one.
      router.refresh();
    });
  }

  const badge = data ? (STATE_BADGE[data.approvalState] ?? STATE_BADGE.NONE) : STATE_BADGE.NONE;

  return (
    <AppShell className="screen-approvals font-jakarta bg-[#f1f5f9] text-slate-800 selection:bg-indigo-500 selection:text-white">
      <AppWindow>
        <header className={CHROME_BAR + " z-20"}>
          <div className="flex items-center gap-3">
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
          <div className="text-[11px] text-slate-500">
            {queue.length} awaiting decision
          </div>
        </header>

        <WindowScroll className={SCROLL_PADDING + " bg-slate-50/60"}>
          {data === null ? (
            <EmptyQueue />
          ) : (
            <>
              {/* Title row */}
              <section className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Link
                      className="inline-flex items-center text-xs font-semibold text-indigo-600 hover:text-indigo-700 transition-colors"
                      href={ROUTES.sales}
                    >
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
                    Review pricing exceptions and approve quotation {data.quoteNumber} before locking
                    commercials.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs shadow-xs flex items-center gap-2">
                    <span className="text-slate-400">Customer:</span>
                    <span className="font-semibold text-slate-800">{data.customerName}</span>
                    <span className="text-slate-300 font-jetbrains">·</span>
                    <span className="font-jetbrains text-indigo-600 font-medium">{data.quoteNumber}</span>
                  </div>
                  <div className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs shadow-xs flex items-center gap-2">
                    <span className="text-slate-400">Owner:</span>
                    <span className="font-semibold text-slate-800">{data.salesRepName}</span>
                    <span className="text-slate-300 font-jetbrains">·</span>
                    <span className="text-slate-600">{data.customerTier}</span>
                  </div>
                </div>
              </section>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* LEFT */}
                <div className="lg:col-span-8 flex flex-col gap-5">
                  <QuotationSummary data={data} />
                  <DiscountReview data={data} />
                  <RiskBreakdown data={data} />
                </div>

                {/* RIGHT */}
                <div className="lg:col-span-4 flex flex-col gap-5">
                  <ReviewerBanner data={data} pending={pendingRequest} />

                  <DecisionPanel
                    busy={busy}
                    collecting={collecting}
                    onCancel={() => {
                      setCollecting(null);
                      setProblem(null);
                    }}
                    onCollect={(next) => {
                      setCollecting(next);
                      setProblem(null);
                    }}
                    onDecide={decide}
                    onReason={(value) => {
                      setReason(value);
                      if (problem) setProblem(null);
                    }}
                    problem={problem}
                    reason={reason}
                    settled={settled}
                    state={data.approvalState}
                  />

                  <ApprovalChain data={data} />
                  {queue.length > 1 && <Queue current={data.quotationId} queue={queue} />}
                </div>
              </div>
            </>
          )}
        </WindowScroll>

        <StatusBar />
      </AppWindow>

      <AppDock />
      <DealAssistant
        quotationId={data?.quotationId ?? null}
        screen="approvals"
        subject={data ? `${data.quoteNumber} - ${data.customerName}` : null}
      />
    </AppShell>
  );
}

// ---------------------------------------------------------------------------

function EmptyQueue() {
  return (
    <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs p-8 text-center">
      <p className="text-sm font-bold text-slate-900">Nothing is waiting for a decision</p>
      <p className="text-xs text-slate-500 mt-1">
        Quotations appear here when a line exceeds its category ceiling, or when the risk score
        reaches an approval band.
      </p>
      <Link
        className="inline-block mt-4 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-colors"
        href={ROUTES.sales}
      >
        Back to Sales Workspace
      </Link>
    </div>
  );
}

function QuotationSummary({ data }: { data: ApprovalScreenData }) {
  const initials = data.customerName
    .split(" ")
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();

  const exceeded = data.lines.filter((line) => line.violationPoints > 0);

  return (
    <section className="bg-white rounded-xl border border-slate-200/90 shadow-2xs p-5">
      <div className="flex items-center justify-between pb-4 border-b border-slate-100">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-sm shadow-xs">
            {initials}
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900 leading-tight">{data.customerName}</h2>
            <p className="text-xs text-slate-500">
              {data.lines.length} line item{data.lines.length === 1 ? "" : "s"} ·{" "}
              {data.customerTier} tier
            </p>
          </div>
        </div>
        <div className="text-right">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 block">
            Quotation Value
          </span>
          <span className="text-xl font-bold text-slate-900 tracking-tight font-jetbrains">
            {formatRupees(data.totalAmount)}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 pt-4">
        <Fact label="Reference ID" value={data.quoteNumber} mono />
        <Fact label="Assigned Rep" value={data.salesRepName} />
        <Fact
          amber
          label="Discount Exception"
          value={
            exceeded.length === 0
              ? "None"
              : `${exceeded[0].discountPercentage}% on ${exceeded[0].productName} (max ${exceeded[0].discountCeiling}%)`
          }
        />
        <Fact label="Estimated Margin" mono value={`${data.marginPercentage}%`} />
      </div>
    </section>
  );
}

function Fact({
  label,
  value,
  mono,
  amber,
}: {
  label: string;
  value: string;
  mono?: boolean;
  amber?: boolean;
}) {
  return (
    <div
      className={
        "p-3 rounded-xl border " +
        (amber ? "bg-amber-50/70 border-amber-200/60" : "bg-slate-50/80 border-slate-100")
      }
    >
      <span
        className={
          "text-[11px] block mb-0.5 font-medium " + (amber ? "text-amber-800" : "text-slate-500")
        }
      >
        {label}
      </span>
      <span
        className={
          "text-xs font-bold " +
          (amber ? "text-amber-900" : "text-slate-800") +
          (mono ? " font-jetbrains" : "")
        }
      >
        {value}
      </span>
    </div>
  );
}

function DiscountReview({ data }: { data: ApprovalScreenData }) {
  const exceptions = data.lines.filter((line) => line.violationPoints > 0).length;

  return (
    <section className="bg-white rounded-xl border border-slate-200/90 shadow-2xs overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-white">
        <div className="flex items-center gap-2.5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
            Discount Review
          </h3>
          <span
            className={
              "px-2 py-0.5 text-[11px] font-semibold rounded-md border " +
              (exceptions > 0
                ? "bg-rose-50 text-rose-600 border-rose-200"
                : "bg-emerald-50 text-emerald-700 border-emerald-200")
            }
          >
            {exceptions} Exception{exceptions === 1 ? "" : "s"} Detected
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50/75 border-b border-slate-100 text-slate-600 uppercase text-[10px] tracking-wider font-semibold">
            <tr>
              <th className="py-3 px-4">Line Item / Service</th>
              <th className="py-3 px-3 text-center">Qty</th>
              <th className="py-3 px-3 text-right">Unit Price</th>
              <th className="py-3 px-3 text-right">Total</th>
              <th className="py-3 px-3 text-center">Applied Discount</th>
              <th className="py-3 px-3 text-center">Policy Limit</th>
              <th className="py-3 px-4 text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.lines.map((line) => {
              const over = line.violationPoints > 0;
              const excess = (line.discountPercentage - line.discountCeiling).toFixed(1);
              return (
                <tr
                  className={
                    over
                      ? "bg-amber-50/40 hover:bg-amber-50/60 transition-colors border-l-4 border-l-amber-500"
                      : "hover:bg-slate-50/60 transition-colors"
                  }
                  key={line.id}
                >
                  <td className="py-3.5 px-4">
                    <div className={over ? "font-bold text-slate-900" : "font-semibold text-slate-900"}>
                      {line.productName}
                    </div>
                    <div className={"text-[11px] " + (over ? "text-amber-800" : "text-slate-400")}>
                      SKU: {line.sku}
                    </div>
                  </td>
                  <td className="py-3.5 px-3 text-center text-slate-600 font-jetbrains">{line.quantity}</td>
                  <td className="py-3.5 px-3 text-right text-slate-600 font-jetbrains">
                    {formatRupees(line.unitPrice)}
                  </td>
                  <td className="py-3.5 px-3 text-right font-semibold text-slate-900 font-jetbrains">
                    {formatRupees(line.lineTotal)}
                  </td>
                  <td
                    className={
                      "py-3.5 px-3 text-center " +
                      (over ? "font-bold text-amber-700 bg-amber-100/80 rounded" : "font-semibold text-slate-700")
                    }
                  >
                    {line.discountPercentage}%
                  </td>
                  <td className="py-3.5 px-3 text-center text-slate-500">
                    Allowed {line.discountCeiling}%
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    {over ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                        {excess}% Over Ceiling
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        Within limit
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2.5 bg-slate-50/90 border-t border-slate-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1.5 text-[11px] text-slate-500">
        <span>
          Gross {formatRupees(data.subtotal)} less {formatRupees(data.discountAmount)} in discounts.
        </span>
        <span className="font-semibold text-slate-700 font-jetbrains">
          Total: {formatRupees(data.totalAmount)}
        </span>
      </div>
    </section>
  );
}

function RiskBreakdown({ data }: { data: ApprovalScreenData }) {
  const contributing = data.factors.filter((factor) => factor.points > 0);

  return (
    <section className="bg-white border border-slate-200/90 shadow-2xs p-5 rounded-xl">
      <div className="flex items-center justify-between mb-3.5">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">Deal Risk Score</h3>
          <p className="text-xs text-slate-500">
            Automated assessment from pricing rules &amp; account telemetry
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold text-slate-800 tracking-tight font-jetbrains">
            {data.riskScore}
            <span className="text-xs font-medium text-slate-400"> / 100</span>
          </span>
          <span className="px-2.5 py-1 text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 rounded-md">
            {data.riskLevel} Risk
          </span>
        </div>
      </div>

      <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden mb-4">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-amber-400 to-amber-500 transition-all duration-500"
          style={{ width: Math.max(0, Math.min(100, data.riskScore)) + "%" }}
        />
      </div>

      <h4 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2.5">
        Why this deal was flagged ({contributing.length} contributing factor
        {contributing.length === 1 ? "" : "s"} of {data.factors.length})
      </h4>
      <div className="space-y-2">
        {data.factors.map((factor) => {
          const tone = FACTOR_TONE[factor.source] ?? FACTOR_TONE.DEVIATION_BREADTH;
          return (
            <div
              className="p-2.5 bg-slate-50 rounded-lg border border-slate-100 flex items-center justify-between text-xs gap-3"
              key={factor.id}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className={"w-1.5 h-1.5 rounded-full shrink-0 " + tone.dot} />
                {/* D22: the engine explains itself, so this is its wording. */}
                <span className="text-slate-700 truncate">{factor.description}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] text-slate-400 font-jetbrains">{factor.formula}</span>
                <span className={"font-bold font-jetbrains " + tone.points}>+{factor.points} pts</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ReviewerBanner({
  data,
  pending,
}: {
  data: ApprovalScreenData;
  pending: ApprovalScreenData["requests"][number] | null;
}) {
  return (
    <section className="bg-gradient-to-br from-indigo-50/80 via-white to-white border border-indigo-100 p-4 shadow-2xs rounded-xl">
      <div className="flex items-start gap-3">
        <div className="p-2 bg-indigo-600 text-white rounded-lg shadow-xs shrink-0 mt-0.5 text-xs font-bold">
          {pending ? pending.stepOrder : "—"}
        </div>
        <div>
          <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
            {pending ? `Awaiting ${humanRole(pending.approverRole)}` : "No decision outstanding"}
          </h4>
          <p className="text-xs text-slate-600 mt-1">
            Requested by <span className="font-semibold text-slate-800">{data.salesRepName}</span>
            {pending && ` · ${pending.requestedAgo}`}
          </p>
          {pending && (
            <p className="mt-2 text-[11px] text-indigo-900 bg-indigo-100/70 rounded px-2.5 py-1">
              {pending.triggerReason}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function DecisionPanel({
  state,
  settled,
  busy,
  collecting,
  reason,
  problem,
  onCollect,
  onCancel,
  onReason,
  onDecide,
}: {
  state: string;
  settled: boolean;
  busy: boolean;
  collecting: "REJECT" | "RETURN" | null;
  reason: string;
  problem: string | null;
  onCollect: (next: "REJECT" | "RETURN") => void;
  onCancel: () => void;
  onReason: (value: string) => void;
  onDecide: (decision: Decision) => void;
}) {
  return (
    <section className="bg-white border border-slate-200/90 shadow-2xs p-5 relative overflow-hidden rounded-xl">
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 mb-1">Decision Panel</h3>
      <p className="text-xs text-slate-500 mb-4">Select an outcome for this pricing exception</p>

      {settled && (
        <div className="mb-4 p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700">
          This quotation is <strong>{STATE_BADGE[state]?.label ?? state}</strong>. There is nothing
          left to decide.
        </div>
      )}

      {collecting && (
        <div className="mb-4">
          <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="reason">
            {collecting === "RETURN"
              ? "Revision Notes for Sales Rep (Required)"
              : "Reason for Deal Rejection (Required)"}
          </label>
          <textarea
            className="w-full text-xs p-2.5 rounded-lg border border-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 placeholder-slate-400 transition-colors"
            id="reason"
            onChange={(event) => onReason(event.target.value)}
            placeholder="Explain the reason for your decision or terms to adjust..."
            rows={3}
            value={reason}
          />
          <div className="flex items-center justify-end gap-2 mt-2">
            <button
              className="px-2.5 py-1 text-xs text-slate-600 hover:text-slate-800 transition-colors font-medium"
              onClick={onCancel}
              type="button"
            >
              Cancel
            </button>
            <button
              className="px-3 py-1 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg shadow-sm disabled:opacity-60"
              disabled={busy}
              onClick={() => onDecide(collecting)}
              type="button"
            >
              {busy ? "Recording…" : "Confirm Action"}
            </button>
          </div>
        </div>
      )}

      {problem && (
        <p className="text-[11px] text-rose-600 mb-3 font-medium" role="alert">
          {problem}
        </p>
      )}

      <div className={"space-y-2.5 " + (settled || busy ? "opacity-50 pointer-events-none" : "")}>
        <button
          className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs font-bold rounded-xl shadow-md shadow-indigo-600/20 transition-all flex items-center justify-center gap-2"
          onClick={() => onDecide("APPROVE")}
          type="button"
        >
          Approve Quotation
        </button>
        <button
          className="w-full py-2 px-4 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-semibold rounded-xl transition-colors"
          onClick={() => onCollect("RETURN")}
          type="button"
        >
          Return for Revision
        </button>
        <button
          className="w-full py-2 px-4 bg-white hover:bg-rose-50 border border-rose-200 text-rose-600 text-xs font-semibold rounded-xl transition-colors"
          onClick={() => onCollect("REJECT")}
          type="button"
        >
          Reject Quotation
        </button>
      </div>
    </section>
  );
}

function ApprovalChain({ data }: { data: ApprovalScreenData }) {
  return (
    <section className="bg-white border border-slate-200/90 shadow-2xs p-5 rounded-xl">
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 mb-4">Approval Chain</h3>
      <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
        {data.requests.map((request) => (
          <div className="relative" key={request.id}>
            <div
              className={
                "absolute -left-6 top-0 w-5 h-5 rounded-full text-white flex items-center justify-center ring-4 ring-white shadow-xs text-[9px] font-bold " +
                (request.status === "PENDING"
                  ? "bg-amber-500"
                  : request.status === "APPROVED"
                    ? "bg-emerald-600"
                    : "bg-rose-500")
              }
            >
              {request.stepOrder}
            </div>
            <div className="pl-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-900">
                  {request.stepName}: {humanRole(request.approverRole)}
                </span>
                <span
                  className={
                    "text-[10px] font-semibold px-2 py-0.5 rounded " +
                    (REQUEST_BADGE[request.status] ?? REQUEST_BADGE.PENDING)
                  }
                >
                  {request.status}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">{request.triggerReason}</p>
              {request.decisionReason && (
                <p className="text-[11px] text-slate-600 mt-1 bg-slate-50 rounded px-2 py-1 border border-slate-100">
                  {request.decisionReason}
                </p>
              )}
              <p className="text-[11px] text-slate-400 mt-1 font-jetbrains">
                {request.actedAt
                  ? `Decided ${new Date(request.actedAt).toLocaleString()}`
                  : `Submitted ${new Date(request.requestedAt).toLocaleString()}`}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Queue({ queue, current }: { queue: QueueEntry[]; current: string }) {
  return (
    <section className="bg-white border border-slate-200/90 shadow-2xs p-4 rounded-xl">
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 mb-3">
        Also awaiting decision
      </h3>
      <ul className="space-y-1.5 text-xs">
        {queue
          .filter((entry) => entry.id !== current)
          .map((entry) => (
            <li key={entry.id}>
              <Link
                className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 transition-colors"
                href={`/approvals?id=${entry.id}`}
              >
                <span className="truncate text-slate-700 font-medium">{entry.customerName}</span>
                <span className="font-jetbrains text-[11px] text-slate-400 shrink-0">
                  {entry.quoteNumber}
                </span>
              </Link>
            </li>
          ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------

function humanRole(role: string): string {
  return role
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}
