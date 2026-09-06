"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CustomerDesktop,
  CustomerDock,
  CustomerHeader,
  CustomerStatusBar,
  CustomerStatusPill,
} from "@/components/customer-shell";
import { formatRupees } from "@/lib/money";
import { useDealEvents } from "@/lib/use-deal-events";
import { QuotationHelper } from "./quotation-helper";

/**
 * The interactive half of the customer's quotation view.
 *
 * Every number on this screen arrived from the server already computed and
 * already filtered. Nothing here recalculates a total, decides whether a
 * discount needs approval, or infers what the seller will do - the customer
 * frontend displays backend results and nothing else (§12, §18).
 *
 * After every mutation the page re-fetches through `router.refresh()` rather
 * than patching local state. A counter-offer can move the quotation back into
 * approval, which changes its status, its buttons and whether it can be
 * confirmed at all; re-reading is the only way the screen is telling the truth
 * afterwards (§17).
 */

export interface DetailLine {
  lineId: string;
  productName: string;
  quantity: number;
  unitPrice: string;
  discountPercentage: string;
  lineTotal: string;
}

export interface DetailQuotation {
  id: string;
  quoteNumber: string;
  status: string;
  currency: string;
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  totalAmount: string;
  validUntil: string | null;
  awaitingSellerReview: boolean;
  version: string;
  lines: DetailLine[];
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
    comments: { id: string; message: string; createdAt: string }[];
  };
}

type Mode = "none" | "change" | "discount";

/** What the customer is told for each outcome the server can return. */
const OUTCOME_MESSAGE: Record<string, string> = {
  ACCEPTED_NO_REAPPROVAL:
    "Your request has been applied to this quotation. The revised terms are shown above.",
  ACCEPTED_PENDING_APPROVAL:
    "Your request is under review by the seller's team. We will update this quotation once it has been assessed.",
  SUBMITTED: "Your request has been sent to your account manager.",
};

export function QuotationDetailClient({
  quotation,
  customerName,
  accountManager,
}: {
  quotation: DetailQuotation;
  customerName: string;
  accountManager: string | null;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();

  const [mode, setMode] = useState<Mode>("none");
  const [targetLineId, setTargetLineId] = useState(quotation.lines[0]?.lineId ?? "");
  const [message, setMessage] = useState("");
  const [counter, setCounter] = useState("");
  const [chat, setChat] = useState("");
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  // The seller can approve, revise or reject this quotation while the customer
  // is looking at it. Re-reading on the event is what turns "refresh to see if
  // anything happened" into the page simply being right.
  const { connected } = useDealEvents({
    surface: "portal",
    quotationId: quotation.id,
    onEvent: (event) => {
      router.refresh();
      if (event.type === "APPROVAL_COMPLETED") {
        setNotice({
          tone: "ok",
          text: "The seller has reviewed this quotation. The latest terms are shown above.",
        });
      }
    },
  });


  const confirmable = quotation.status === "Ready to Confirm";
  // Once a quotation is confirmed there is nothing left to ask for, so the
  // drafting half of the helper stands down and only the explainer remains.
  const negotiable = quotation.status !== "Confirmed";

  async function send(
    body: Record<string, unknown>,
    onDone?: () => void,
  ): Promise<void> {
    setNotice(null);
    const response = await fetch(`/api/portal/quotations/${quotation.id}/negotiate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as
      | { outcome?: string; error?: string }
      | null;

    if (!response.ok) {
      setNotice({ tone: "warn", text: payload?.error ?? "That request could not be sent." });
      return;
    }

    setNotice({
      tone: payload?.outcome === "ACCEPTED_NO_REAPPROVAL" ? "ok" : "warn",
      text: OUTCOME_MESSAGE[payload?.outcome ?? "SUBMITTED"] ?? OUTCOME_MESSAGE.SUBMITTED,
    });
    onDone?.();
    // The quotation may now be in a different state entirely. Re-read it.
    router.refresh();
  }

  function submitChange() {
    if (!message.trim()) {
      setNotice({ tone: "warn", text: "Please describe the change you would like." });
      return;
    }
    startTransition(async () => {
      await send(
        { requestType: "OTHER", lineId: targetLineId || null, reason: message.trim() },
        () => {
          setMessage("");
          setMode("none");
        },
      );
    });
  }

  function submitCounter() {
    const value = Number.parseFloat(counter);
    if (Number.isNaN(value) || value < 0 || value > 100) {
      setNotice({ tone: "warn", text: "Enter a discount between 0 and 100 percent." });
      return;
    }
    if (!targetLineId) {
      setNotice({ tone: "warn", text: "Choose which item the discount applies to." });
      return;
    }
    startTransition(async () => {
      await send(
        {
          requestType: "COUNTER_DISCOUNT",
          lineId: targetLineId,
          requestedValue: value,
          reason: message.trim() || null,
        },
        () => {
          setCounter("");
          setMessage("");
          setMode("none");
        },
      );
    });
  }

  function sendChat() {
    if (!chat.trim()) return;
    startTransition(async () => {
      await send({ requestType: "QUESTION", reason: chat.trim() }, () => setChat(""));
    });
  }

  function confirm() {
    startTransition(async () => {
      setNotice(null);
      const response = await fetch(`/api/portal/quotations/${quotation.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The version the customer is looking at. If the quotation moved while
        // this page was open, the server refuses rather than confirming terms
        // they never saw.
        body: JSON.stringify({ expectedVersion: quotation.version }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { message?: string; error?: string }
        | null;

      if (response.status === 409) {
        setNotice({
          tone: "warn",
          text: payload?.message ?? "This quote just changed - please review the updated terms.",
        });
        router.refresh();
        return;
      }
      if (!response.ok) {
        setNotice({ tone: "warn", text: payload?.error ?? "This quotation could not be confirmed." });
        return;
      }
      router.push(`/my/quotations/${quotation.id}/confirmed`);
      router.refresh();
    });
  }

  const targetLine = quotation.lines.find((line) => line.lineId === targetLineId) ?? null;

  return (
    <CustomerDesktop>
      <main className="w-full max-w-6xl bg-white border border-slate-200/90 rounded-2xl shadow-2xl shadow-slate-300/40 overflow-hidden flex flex-col min-h-[820px] max-h-[calc(100vh-4rem)] my-auto">
        <CustomerHeader
          backHref="/my/quotations"
          customerName={customerName}
          page="Quotation Details &amp; Negotiation"
          quoteNumber={quotation.quoteNumber}
        />

        <div className="flex-1 min-h-0 overflow-y-auto app-scroll p-4 sm:p-6 space-y-5 bg-[#fafbfe]">
          {/* Header card */}
          <section className="bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                  Quotation #{quotation.quoteNumber}
                </h1>
                <CustomerStatusPill status={quotation.status} />
              </div>
              <p className="text-sm text-slate-500 mt-1">
                {quotation.lines.length} item{quotation.lines.length === 1 ? "" : "s"} ·{" "}
                {quotation.lines
                  .slice(0, 2)
                  .map((line) => line.productName)
                  .join(", ")}
              </p>
              {quotation.validUntil && (
                <p className="text-xs text-slate-500 mt-1.5">
                  Valid until{" "}
                  <span className="font-semibold text-slate-700">
                    {new Date(quotation.validUntil).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                </p>
              )}
            </div>

            <div className="lg:text-right">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                Total Quotation Value
              </div>
              <div className="text-3xl font-bold text-slate-900 font-jetbrains">
                {formatRupees(quotation.totalAmount)}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">Inclusive of standard taxes</div>
            </div>
          </section>

          {notice && (
            <p
              className={`rounded-xl border px-4 py-3 text-xs leading-relaxed ${
                notice.tone === "ok"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : "bg-amber-50 border-amber-200 text-amber-900"
              }`}
              role="status"
            >
              {notice.text}
            </p>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 space-y-5">
              {/* Lines */}
              <section className="bg-white border border-slate-200/90 rounded-2xl overflow-hidden">
                <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">Your Quotation</h2>
                    <p className="text-xs text-slate-500 mt-0.5">Deliverables and agreed rates</p>
                  </div>
                  <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
                    {quotation.lines.length} Items
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-xs">
                    <thead className="bg-slate-50/75 border-b border-slate-100 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">
                      <tr>
                        <th className="py-3 px-5" scope="col">Product</th>
                        <th className="py-3 px-3 text-right" scope="col">Quantity</th>
                        <th className="py-3 px-3 text-right" scope="col">Unit Price</th>
                        <th className="py-3 px-3 text-center" scope="col">Discount</th>
                        <th className="py-3 px-5 text-right" scope="col">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {quotation.lines.map((line) => (
                        <tr key={line.lineId}>
                          <td className="py-4 px-5 font-semibold text-slate-900">{line.productName}</td>
                          <td className="py-4 px-3 text-right font-jetbrains text-slate-700">
                            {line.quantity}
                          </td>
                          <td className="py-4 px-3 text-right font-jetbrains text-slate-700">
                            {formatRupees(line.unitPrice)}
                          </td>
                          <td className="py-4 px-3 text-center">
                            <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              {Number(line.discountPercentage).toFixed(0)}%
                            </span>
                          </td>
                          <td className="py-4 px-5 text-right font-jetbrains font-bold text-slate-900">
                            {formatRupees(line.lineTotal)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="bg-slate-50/70 border-t border-slate-100 px-5 py-4 space-y-1.5 text-xs">
                  <Row label="Subtotal:" value={formatRupees(quotation.subtotal)} />
                  <Row label="Discount applied:" value={`- ${formatRupees(quotation.discountAmount)}`} />
                  <Row label="Taxes:" value={formatRupees(quotation.taxAmount)} />
                  <div className="pt-2 mt-1 border-t border-slate-200/70">
                    <Row bold label="Total:" value={formatRupees(quotation.totalAmount)} />
                  </div>
                </div>
              </section>

              <QuotationHelper
                canNegotiate={negotiable}
                onUseDraft={(text) => {
                  // Drops the wording into the customer's own form rather than
                  // sending it. They still read it, edit it and press send.
                  setMessage(text);
                  setMode("change");
                }}
                quotationId={quotation.id}
              />

              {/* Negotiation */}
              <section className="bg-white border border-slate-200/90 rounded-2xl p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">Negotiate this quotation</h2>
                    <p className="text-xs text-slate-500 mt-0.5 max-w-md">
                      Have a question or want to request a change? Send your request directly to the
                      sales team.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className={
                        mode === "change"
                          ? "px-3.5 py-2 rounded-lg text-xs font-semibold bg-slate-900 text-white"
                          : "px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
                      }
                      onClick={() => setMode(mode === "change" ? "none" : "change")}
                      type="button"
                    >
                      Request a Change
                    </button>
                    <button
                      className={
                        mode === "discount"
                          ? "px-3.5 py-2 rounded-lg text-xs font-bold bg-slate-900 text-white"
                          : "px-3.5 py-2 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
                      }
                      onClick={() => setMode(mode === "discount" ? "none" : "discount")}
                      type="button"
                    >
                      Propose Discount
                    </button>
                  </div>
                </div>

                {mode !== "none" && (
                  <div className="mt-4 bg-slate-50/70 border border-slate-200/80 rounded-xl p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="text-xs font-semibold text-slate-700" htmlFor="target-line">
                        Target product
                      </label>
                      <span className="text-[11px] text-slate-400">Line-level revision request</span>
                    </div>
                    <select
                      className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                      id="target-line"
                      onChange={(event) => setTargetLineId(event.target.value)}
                      value={targetLineId}
                    >
                      {quotation.lines.map((line) => (
                        <option key={line.lineId} value={line.lineId}>
                          {line.productName} — currently {Number(line.discountPercentage).toFixed(0)}%
                        </option>
                      ))}
                    </select>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="note">
                        Message {mode === "discount" && <span className="text-slate-400">(optional)</span>}
                      </label>
                      <textarea
                        className="w-full text-xs p-3 border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 resize-none"
                        id="note"
                        onChange={(event) => setMessage(event.target.value)}
                        placeholder="Explain the change you would like your account manager to review…"
                        rows={3}
                        value={message}
                      />
                    </div>

                    {mode === "discount" && (
                      <div className="flex flex-wrap items-end gap-3">
                        <div>
                          <label
                            className="block text-xs font-semibold text-slate-700 mb-1"
                            htmlFor="counter"
                          >
                            Proposed discount
                          </label>
                          <div className="flex items-center gap-1.5">
                            <input
                              className="w-24 text-xs px-3 py-2 border border-slate-200 rounded-lg bg-white font-jetbrains focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                              id="counter"
                              max="100"
                              min="0"
                              onChange={(event) => setCounter(event.target.value)}
                              placeholder="17"
                              type="number"
                              value={counter}
                            />
                            <span className="text-xs text-slate-500">%</span>
                          </div>
                        </div>
                        {targetLine && (
                          <p className="text-[11px] text-slate-500 pb-2">
                            {targetLine.productName} is currently at{" "}
                            {Number(targetLine.discountPercentage).toFixed(0)}%. Your proposal will be
                            reviewed by the sales team.
                          </p>
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                        onClick={() => setMode("none")}
                        type="button"
                      >
                        Cancel
                      </button>
                      <button
                        className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-60"
                        disabled={busy}
                        onClick={mode === "discount" ? submitCounter : submitChange}
                        type="button"
                      >
                        {busy
                          ? "Sending…"
                          : mode === "discount"
                            ? "Submit Counter Offer"
                            : "Submit Request"}
                      </button>
                    </div>
                  </div>
                )}
              </section>

              {/* Conversation */}
              <section className="bg-white border border-slate-200/90 rounded-2xl p-5">
                <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">Conversation</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Direct channel with your commercial lead
                    </p>
                  </div>
                  <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full shrink-0">
                    Direct Sales Channel
                  </span>
                </div>

                <div className="py-4 space-y-3">
                  {quotation.conversation.requests.length === 0 &&
                    quotation.conversation.comments.length === 0 && (
                      <p className="text-xs text-slate-500">
                        No messages yet. Use the buttons above to start a conversation about these
                        terms.
                      </p>
                    )}

                  {quotation.conversation.requests.map((request) => (
                    <div
                      className="bg-slate-50 border border-slate-200/70 rounded-xl px-4 py-3"
                      key={request.id}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-bold text-slate-900">
                          {customerName} <span className="font-medium text-slate-500">(you)</span>
                        </span>
                        <span className="text-[11px] text-slate-400">
                          {new Date(request.createdAt).toLocaleString("en-IN", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <p className="text-xs text-slate-700 mt-1 leading-relaxed">
                        {request.requestType === "COUNTER_DISCOUNT" && request.requestedValue
                          ? `Requested ${Number(request.requestedValue).toFixed(0)}% discount${
                              request.reason ? ` — ${request.reason}` : ""
                            }`
                          : (request.reason ?? "Change requested")}
                      </p>
                      <span className="inline-block mt-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        {request.status}
                      </span>
                    </div>
                  ))}

                  {quotation.conversation.comments.map((comment) => (
                    <div
                      className="bg-indigo-50/50 border border-indigo-100 rounded-xl px-4 py-3"
                      key={comment.id}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-bold text-indigo-900">
                          Sales Team
                          {accountManager && (
                            <span className="font-medium text-indigo-700"> ({accountManager})</span>
                          )}
                        </span>
                        <span className="text-[11px] text-indigo-400">
                          {new Date(comment.createdAt).toLocaleString("en-IN", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <p className="text-xs text-indigo-900/90 mt-1 leading-relaxed">
                        {comment.message}
                      </p>
                    </div>
                  ))}
                </div>

                <form
                  className="flex items-center gap-2 pt-3 border-t border-slate-100"
                  onSubmit={(event) => {
                    event.preventDefault();
                    sendChat();
                  }}
                >
                  <input
                    className="flex-1 min-w-0 text-xs px-3 py-2.5 border border-slate-200 rounded-lg bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition-all"
                    disabled={busy}
                    onChange={(event) => setChat(event.target.value)}
                    placeholder="Write a message…"
                    value={chat}
                  />
                  <button
                    className="shrink-0 px-4 py-2.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50"
                    disabled={busy || !chat.trim()}
                    type="submit"
                  >
                    Send
                  </button>
                </form>
              </section>
            </div>

            {/* Right rail */}
            <div className="space-y-5">
              <section className="bg-white border border-slate-200/90 rounded-2xl p-5">
                <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-100">
                  <h2 className="text-sm font-bold text-slate-900">Quotation Summary</h2>
                  <CustomerStatusPill status={quotation.status} />
                </div>

                <dl className="py-3 space-y-2.5 text-xs">
                  <Detail label="Items" value={String(quotation.lines.length)} />
                  <Detail label="Current Total" mono value={formatRupees(quotation.totalAmount)} />
                  <Detail label="Status" value={quotation.status} />
                  <Detail
                    label="Validity"
                    value={
                      quotation.validUntil
                        ? new Date(quotation.validUntil).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })
                        : "—"
                    }
                  />
                </dl>

                <div className="pt-3 border-t border-slate-100 space-y-2">
                  <button
                    className="w-full px-4 py-2.5 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={busy || !confirmable}
                    onClick={confirm}
                    title={confirmable ? undefined : "This quotation is not ready to confirm yet"}
                    type="button"
                  >
                    {busy ? "Working…" : "Confirm Quotation →"}
                  </button>
                  <button
                    className="w-full px-4 py-2.5 rounded-lg text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-200 hover:bg-slate-100 transition-colors"
                    onClick={() => setMode("discount")}
                    type="button"
                  >
                    Request Commercial Revision
                  </button>

                  <p className="text-[11px] text-slate-400 leading-relaxed pt-1 flex items-center gap-1.5">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-slate-300"}`}
                    />
                    {connected ? "Live - updates as the seller responds" : "Reconnecting…"}
                  </p>

                  <p className="text-[11px] text-slate-500 leading-relaxed pt-1">
                    {quotation.awaitingSellerReview
                      ? "Your request is under review by the seller's team. You can confirm once the revised terms are issued."
                      : confirmable
                        ? "By confirming, your commercial order enters fulfilment and legal execution."
                        : "This quotation is not yet available for confirmation."}
                  </p>
                </div>
              </section>

              {accountManager && (
                <section className="bg-white border border-slate-200/90 rounded-2xl p-5 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-xs shrink-0">
                    {accountManager
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((word) => word.charAt(0).toUpperCase())
                      .join("")}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900 truncate">{accountManager}</p>
                    <p className="text-[11px] text-slate-500">Your commercial lead</p>
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>

        <CustomerStatusBar />
      </main>

      <CustomerDock active="quotes" quotationId={quotation.id} />
    </CustomerDesktop>
  );
}

function Row({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={bold ? "font-bold text-slate-900" : "text-slate-500"}>{label}</span>
      <span className={`font-jetbrains ${bold ? "font-bold text-indigo-700 text-sm" : "text-slate-800"}`}>
        {value}
      </span>
    </div>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`font-semibold text-slate-900 text-right ${mono ? "font-jetbrains" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
