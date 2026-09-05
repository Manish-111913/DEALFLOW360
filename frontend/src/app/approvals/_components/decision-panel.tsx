"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The Decision Panel and the two things it drives: the header status badge and
 * step 1 of the approval chain.
 *
 * The decision is one value with four states. Approve is immediate; Return for
 * Revision and Reject first open the reason box and only take effect once a
 * non-empty note is confirmed. Once any decision lands the buttons go
 * `opacity-50 pointer-events-none` and stay that way, exactly as before.
 *
 * The empty-note guard used `alert()` in the source. That blocks the tab and
 * cannot be styled, so the message is shown inline under the textarea instead -
 * the rule it enforces is unchanged.
 */

export type Decision = "pending" | "approved" | "revision" | "rejected";

export function DecisionPanel({
  decision,
  onDecide,
}: {
  decision: Decision;
  onDecide: (decision: Decision) => void;
}) {
  // Which decision the reason box is collecting a note for, if it is open.
  const [collecting, setCollecting] = useState<"revision" | "rejected" | null>(null);
  const [reason, setReason] = useState("");
  const [missingReason, setMissingReason] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (collecting) reasonRef.current?.focus();
  }, [collecting]);

  const settled = decision !== "pending";

  function confirm() {
    if (!reason.trim()) {
      setMissingReason(true);
      return;
    }
    if (collecting) onDecide(collecting);
    setCollecting(null);
    setMissingReason(false);
  }

  function startCollecting(next: "revision" | "rejected") {
    setCollecting(next);
    setMissingReason(false);
  }

  return (
    <section className="bg-white border border-slate-200/90 shadow-2xs p-5 relative overflow-hidden rounded-xl">
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 mb-1">Decision Panel</h3>
      <p className="text-xs text-slate-500 mb-4">Select an outcome for this pricing exception</p>

      {/* Success feedback, shown only after an approval */}
      {decision === "approved" && (
        <div className="mb-4 p-3.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 animate-fadeIn">
          <div className="flex items-start gap-2">
            <svg className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path
                clipRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                fillRule="evenodd"
              />
            </svg>
            <div>
              <strong className="font-bold block text-emerald-900">Quotation Approved ✓</strong>
              <span>
                DF-2024-1082 has been approved by the Sales Manager. Commercial terms are locked.
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Reason box, for a revision or a rejection */}
      {collecting && (
        <div className="mb-4 transition-all">
          <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="decisionReasonText">
            {collecting === "revision"
              ? "Revision Notes for Sales Rep (Required)"
              : "Reason for Deal Rejection (Required)"}
          </label>
          <textarea
            className="w-full text-xs p-2.5 rounded-lg border border-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 placeholder-slate-400 transition-colors"
            id="decisionReasonText"
            onChange={(event) => {
              setReason(event.target.value);
              if (missingReason) setMissingReason(false);
            }}
            placeholder="Explain the reason for your decision or terms to adjust..."
            ref={reasonRef}
            rows={3}
            value={reason}
          />
          {missingReason && (
            <p className="text-[11px] text-rose-600 mt-1 font-medium">
              Please enter a note before confirming this action.
            </p>
          )}
          <div className="flex items-center justify-end gap-2 mt-2">
            <button
              className="px-2.5 py-1 text-xs text-slate-600 hover:text-slate-800 transition-colors font-medium"
              onClick={() => {
                setCollecting(null);
                setMissingReason(false);
              }}
              type="button"
            >
              Cancel
            </button>
            <button
              className="px-3 py-1 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg shadow-sm"
              onClick={confirm}
              type="button"
            >
              Confirm Action
            </button>
          </div>
        </div>
      )}

      {/* Decision Action Buttons */}
      <div className={"space-y-2.5 " + (settled ? "opacity-50 pointer-events-none" : "")}>
        <button
          className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs font-bold rounded-xl shadow-md shadow-indigo-600/20 hover:shadow transition-all flex items-center justify-center gap-2"
          onClick={() => {
            setCollecting(null);
            onDecide("approved");
          }}
          type="button"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
          </svg>
          Approve Quotation
        </button>

        <button
          className="w-full py-2 px-4 bg-white hover:bg-slate-50 border border-slate-300 active:bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl transition-colors flex items-center justify-center gap-1.5"
          onClick={() => startCollecting("revision")}
          type="button"
        >
          <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
          </svg>
          Return for Revision
        </button>

        <button
          className="w-full py-2 px-4 bg-white hover:bg-rose-50 border border-rose-200 active:bg-rose-100 text-rose-600 text-xs font-semibold rounded-xl transition-colors flex items-center justify-center gap-1.5"
          onClick={() => startCollecting("rejected")}
          type="button"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
          </svg>
          Reject Quotation
        </button>
      </div>
    </section>
  );
}
