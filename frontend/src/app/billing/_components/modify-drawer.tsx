"use client";

import { useEffect, useState } from "react";
import { formatIndian, formatRupees } from "./indian-currency";

/**
 * The right-hand drawer for changing the subscription's seat count.
 *
 * The proration arithmetic is the source screen's, unchanged:
 *
 *   newRate    = seats × ₹1,200
 *   delta      = round((seats − 10) × 1200 / 30 × 10)   // 10 days left in cycle
 *   nextTotal  = newRate + max(delta, 0)                // a credit is not
 *                                                       // added to the invoice
 *
 * It opens on 12 seats rather than the plan's current 10, which is what the
 * original did - the stepper is a proposal, not a mirror of the plan.
 */

const SEAT_PRICE = 1_200;
const CURRENT_SEATS = 10;
/** Days left in the cycle that the prorated adjustment covers. */
const REMAINING_DAYS = 10;
const CYCLE_DAYS = 30;

export function ModifyDrawer({
  onConfirm,
  onClose,
}: {
  onConfirm: (seats: number) => void;
  onClose: () => void;
}) {
  const [seats, setSeats] = useState(12);
  // The drawer slides in from the right, so it has to mount off-screen first
  // and move on the next frame - the source screen used a 10ms timeout.
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setShown(true), 10);
    return () => clearTimeout(id);
  }, []);

  const newRate = seats * SEAT_PRICE;
  const delta = Math.round(
    ((seats - CURRENT_SEATS) * SEAT_PRICE / CYCLE_DAYS) * REMAINING_DAYS,
  );
  const nextTotal = newRate + (delta > 0 ? delta : 0);

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
              <p className="text-xs text-slate-500">Cloud Operations &amp; Maintenance</p>
            </div>
            <button className="text-slate-400 hover:text-slate-700 p-1" onClick={onClose} type="button">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
              </svg>
            </button>
          </div>

          {/* Quantity Stepper */}
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
              <span className="text-xl font-extrabold text-slate-900 w-12 text-center font-mono">
                {seats}
              </span>
              <button
                className="w-9 h-9 rounded-lg border border-slate-200 flex items-center justify-center font-bold text-slate-600 hover:bg-slate-50 active:scale-95 transition-all"
                onClick={() => setSeats((current) => current + 1)}
                type="button"
              >
                +
              </button>
              <span className="text-xs text-slate-500 pl-2">(Previously {CURRENT_SEATS} units)</span>
            </div>

            {/* Proration Live Calculation */}
            <div className="mt-6 bg-slate-50 rounded-xl p-4 border border-slate-200 text-xs space-y-2.5">
              <div className="font-bold text-slate-800 text-[11px] uppercase tracking-wider">
                Live Proration Impact
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Current Monthly Rate:</span>
                <span className="font-mono">₹12,000.00</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>New Monthly Rate ({seats} seats):</span>
                <span className="font-mono font-bold text-slate-900">{formatRupees(newRate)}</span>
              </div>
              <div className="flex justify-between text-indigo-700 font-medium">
                <span>Prorated adjustment ({REMAINING_DAYS} remaining days):</span>
                <span className="font-mono font-bold">
                  {delta >= 0 ? "+" : ""}₹{formatIndian(delta)}.00
                </span>
              </div>
              <div className="pt-2 border-t border-slate-200 flex justify-between font-extrabold text-slate-900 text-sm">
                <span>Next Invoice Total (01 Oct):</span>
                <span className="text-indigo-700 font-mono">{formatRupees(nextTotal)}</span>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 mt-2">
              Proration will be posted to unbilled ledger immediately and reflected in customer&apos;s
              upcoming cycle.
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="pt-4 border-t border-slate-100 flex items-center justify-end space-x-3">
          <button
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors"
            onClick={() => onConfirm(seats)}
            type="button"
          >
            Confirm Quantity Change
          </button>
        </div>
      </div>
    </div>
  );
}
