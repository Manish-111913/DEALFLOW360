"use client";

import { useEffect, useState } from "react";
import { formatRupees } from "@/lib/money";

/**
 * The drawer for changing a subscription's seat count.
 *
 * It no longer does the proration arithmetic. The old version reproduced the
 * formula in the browser - seats x price, minus the old rate, times the days
 * remaining - which meant the number a user agreed to was computed by different
 * code from the number that got written. `changeSubscriptionQuantity` returns
 * the real adjustment, and that is what the confirmation reports.
 *
 * What is shown here is the part that needs no clock: the new monthly rate.
 */
export function ModifyDrawer({
  productName,
  currentQuantity,
  unitPrice,
  busy,
  onConfirm,
  onClose,
}: {
  productName: string;
  currentQuantity: number;
  unitPrice: number;
  busy: boolean;
  onConfirm: (quantity: number) => void;
  onClose: () => void;
}) {
  const [seats, setSeats] = useState(currentQuantity);
  // The drawer slides in from the right, so it has to mount off-screen and move
  // on the next frame.
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setShown(true), 10);
    return () => clearTimeout(id);
  }, []);

  const newRate = seats * unitPrice;
  const currentRate = currentQuantity * unitPrice;
  const unchanged = seats === currentQuantity;

  return (
    <div
      className={
        "fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 transition-opacity " +
        (shown ? "" : "opacity-0")
      }
    >
      <div
        className={
          "fixed inset-y-0 right-0 max-w-md w-full bg-white shadow-2xl flex flex-col justify-between p-6 transform transition-transform duration-300 " +
          (shown ? "" : "translate-x-full")
        }
      >
        <div>
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Modify Subscription Quantity</h3>
              <p className="text-xs text-slate-500">{productName}</p>
            </div>
            <button className="text-slate-400 hover:text-slate-700 p-1" onClick={onClose} type="button">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
              </svg>
            </button>
          </div>

          <div className="py-5">
            <label className="block text-xs font-semibold text-slate-700 mb-2">
              Adjust Active Seat Units
            </label>
            <div className="flex items-center space-x-3">
              <button
                className="w-9 h-9 rounded-lg border border-slate-200 flex items-center justify-center font-bold text-slate-600 hover:bg-slate-50 active:scale-95 transition-all"
                onClick={() => setSeats((current) => (current > 1 ? current - 1 : current))}
                type="button"
              >
                -
              </button>
              <span className="text-xl font-extrabold text-slate-900 w-12 text-center font-jetbrains">
                {seats}
              </span>
              <button
                className="w-9 h-9 rounded-lg border border-slate-200 flex items-center justify-center font-bold text-slate-600 hover:bg-slate-50 active:scale-95 transition-all"
                onClick={() => setSeats((current) => current + 1)}
                type="button"
              >
                +
              </button>
              <span className="text-xs text-slate-500 pl-2">
                (Currently {currentQuantity} units)
              </span>
            </div>

            <div className="mt-6 bg-slate-50 rounded-xl p-4 border border-slate-200 text-xs space-y-2.5">
              <div className="font-bold text-slate-800 text-[11px] uppercase tracking-wider">
                Rate Change
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Current Monthly Rate:</span>
                <span className="font-jetbrains">{formatRupees(currentRate)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>New Monthly Rate ({seats} seats):</span>
                <span className="font-jetbrains font-bold text-slate-900">{formatRupees(newRate)}</span>
              </div>
              <p className="text-[11px] text-slate-500 pt-2 border-t border-slate-200">
                The prorated adjustment for the remainder of this cycle is calculated by the billing
                service when you confirm, and reported back exactly as it is posted.
              </p>
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-slate-100 flex items-center justify-end space-x-3">
          <button
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors disabled:opacity-60"
            disabled={busy || unchanged}
            onClick={() => onConfirm(seats)}
            type="button"
          >
            {busy ? "Applying…" : "Confirm Quantity Change"}
          </button>
        </div>
      </div>
    </div>
  );
}
