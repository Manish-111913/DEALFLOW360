"use client";

import { useState } from "react";
import { formatRupees } from "@/lib/money";

/**
 * "Request Commercial Adjustment" - the customer's counter-offer form.
 *
 * Validation is deliberately the same shape the service enforces: a counter
 * needs either a percentage or something written, and a percentage has to be a
 * real one. The service checks this too - this is only so the customer is told
 * before a round trip, not instead of it.
 */
export function NegotiationModal({
  title,
  currentDiscount,
  currentTotal,
  busy,
  onSubmit,
  onClose,
}: {
  title: string;
  /** null when countering the whole quotation rather than one line. */
  currentDiscount: number | null;
  currentTotal: string;
  busy: boolean;
  onSubmit: (discount: number, reason: string) => void;
  onClose: () => void;
}) {
  const [discount, setDiscount] = useState(
    currentDiscount === null ? "" : String(currentDiscount + 3),
  );
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  function submit() {
    const value = Number.parseFloat(discount);

    if (Number.isNaN(value) && !reason.trim()) {
      setProblem("Please provide either a counter discount or a comment.");
      return;
    }
    if (!Number.isNaN(value) && (value < 0 || value > 100)) {
      setProblem("Please enter a valid discount percentage between 0% and 100%.");
      return;
    }

    onSubmit(Number.isNaN(value) ? 0 : value, reason.trim());
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Request Commercial Adjustment</h3>
            <p className="text-xs text-slate-500 mt-0.5">{title}</p>
          </div>
          <button className="text-slate-400 hover:text-slate-600 p-1" onClick={onClose} type="button">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
            </svg>
          </button>
        </div>

        <div className="py-4 space-y-4">
          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/70 flex items-center justify-between text-xs">
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                Current Quoted Total
              </span>
              <span className="font-bold text-slate-900 text-sm font-jetbrains">
                {formatRupees(currentTotal)}
              </span>
            </div>
            {currentDiscount !== null && (
              <div className="text-right">
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                  Current Discount
                </span>
                <span className="font-bold text-indigo-600 text-sm">{currentDiscount}%</span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1" htmlFor="counter">
              Propose Counter Discount (%){" "}
              <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              className="w-full text-sm py-2 px-3 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-jetbrains"
              id="counter"
              max="100"
              min="0"
              onChange={(event) => {
                setDiscount(event.target.value);
                if (problem) setProblem(null);
              }}
              placeholder="e.g. 20"
              type="number"
              value={discount}
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1" htmlFor="counter-reason">
              Comments or Specific Terms{" "}
              <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <textarea
              className="w-full text-xs p-3 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              id="counter-reason"
              onChange={(event) => {
                setReason(event.target.value);
                if (problem) setProblem(null);
              }}
              placeholder="Explain what adjustment you would like your account manager to review..."
              rows={3}
              value={reason}
            />
          </div>

          {problem && (
            <p className="text-xs text-rose-600 font-medium" role="alert">
              {problem}
            </p>
          )}

          <div className="bg-indigo-50/50 p-3 rounded-lg border border-indigo-100 text-[11px] text-indigo-900">
            Submitting this will move your quotation to <strong>Under Negotiation</strong>. Your
            account manager will review and reply.
          </div>
        </div>

        <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2.5">
          <button
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition shadow-sm disabled:opacity-60"
            disabled={busy}
            onClick={submit}
            type="button"
          >
            {busy ? "Submitting…" : "Submit Request"}
          </button>
        </div>
      </div>
    </div>
  );
}
