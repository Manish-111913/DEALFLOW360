"use client";

import { useState } from "react";

/**
 * "Request Commercial Adjustment" - the counter-offer form.
 *
 * Validation is the source screen's, in the same order:
 *   1. neither a discount nor a comment  -> "provide either"
 *   2. a discount outside 0-100          -> "between 0% and 100%"
 * A discount alone or a comment alone is accepted.
 *
 * Each open reseeds the form with 15% and a comment naming the line, which is
 * why the target is a prop rather than state - remounting on a new target
 * resets the draft for free.
 */

export interface NegotiationTarget {
  title: string;
  sku: string;
  currentDiscount: number;
  currentTotal: string;
}

export function NegotiationModal({
  target,
  onSubmit,
  onClose,
}: {
  target: NegotiationTarget;
  onSubmit: (discount: number) => void;
  onClose: () => void;
}) {
  const [discount, setDiscount] = useState("15");
  const [comment, setComment] = useState(
    "Could you review the discount for " + target.title + " to match our annual framework?",
  );
  const [error, setError] = useState<"range" | "empty" | null>(null);

  function submit() {
    const value = Number.parseFloat(discount);
    if (Number.isNaN(value) && comment.trim() === "") {
      setError("empty");
      return;
    }
    if (!Number.isNaN(value) && (value < 0 || value > 100)) {
      setError("range");
      return;
    }
    onSubmit(value);
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 transform transition-all">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div>
            <h3 className="text-base font-bold text-slate-900">Request Commercial Adjustment</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {target.title} ({target.sku})
            </p>
          </div>
          <button className="text-slate-400 hover:text-slate-600 p-1" onClick={onClose} type="button">
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>

        <div className="py-4 space-y-4">
          {/* Current Rate Info Card */}
          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/70 flex items-center justify-between text-xs">
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                Current Quoted Total
              </span>
              <span className="font-bold text-slate-900 text-sm font-mono">{target.currentTotal}</span>
            </div>
            <div className="text-right">
              <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                Current Discount
              </span>
              <span className="font-bold text-indigo-600 text-sm">{target.currentDiscount}%</span>
            </div>
          </div>

          {/* Counter Discount Input */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Propose Counter Discount (%){" "}
              <span className="text-slate-400 font-normal">(Optional)</span>
            </label>
            <div className="relative rounded-lg shadow-2xs">
              <input
                className="w-full text-sm py-2 px-3 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 pr-10 font-mono"
                max="100"
                min="0"
                onChange={(event) => {
                  setDiscount(event.target.value);
                  setError(null);
                }}
                placeholder="e.g. 20"
                type="number"
                value={discount}
              />
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400 text-xs font-bold">
                %
              </div>
            </div>
            {error === "range" && (
              <p className="text-xs text-rose-600 mt-1">
                Please enter a valid discount percentage between 0% and 100%.
              </p>
            )}
          </div>

          {/* Comment / Change Request Note */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Comments or Specific Terms <span className="text-slate-400 font-normal">(Optional)</span>
            </label>
            <textarea
              className="w-full text-xs p-3 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
              onChange={(event) => {
                setComment(event.target.value);
                setError(null);
              }}
              placeholder="Explain what adjustment you'd like your account manager to review..."
              rows={3}
              value={comment}
            />
            {error === "empty" && (
              <p className="text-xs text-rose-600 mt-1">
                Please provide either a counter discount or a comment.
              </p>
            )}
          </div>

          <div className="bg-indigo-50/50 p-3 rounded-lg border border-indigo-100 text-[11px] text-indigo-900 flex items-start gap-2">
            <span className="material-symbols-outlined text-sm text-indigo-600 flex-shrink-0 mt-0.5">
              info
            </span>
            <span>
              Submitting this request will update your quotation status to{" "}
              <strong>Under Negotiation</strong>. Your sales rep will review and reply within 4 business
              hours.
            </span>
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
            className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition shadow-sm shadow-indigo-200"
            onClick={submit}
            type="button"
          >
            Submit Request
          </button>
        </div>
      </div>
    </div>
  );
}
