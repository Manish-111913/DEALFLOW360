"use client";

import { useState } from "react";
import { formatRupees } from "@/lib/money";
import type { InvoiceRow } from "./billing-client";

/**
 * Record a payment against an invoice.
 *
 * The amount never becomes a JavaScript number. Money is Decimal(14,2) in the
 * database and this dialog is the top of that column: parsing it here to
 * validate, even briefly, is how a rounding error reaches a ledger. It is
 * validated as text, sent as text, and compared against the outstanding balance
 * as text, using the same two-decimal shape the API insists on.
 *
 * Chrome, spacing and button weights are the Cancel Subscription modal's, which
 * is this screen's existing dialog.
 */

const METHODS = [
  { value: "BANK_TRANSFER", label: "Bank Transfer" },
  { value: "CARD", label: "Card" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "CASH", label: "Cash" },
  { value: "OTHER", label: "Other" },
] as const;

/** Rupees and paise as an integer count of paise, so comparisons stay exact. */
function paise(amount: string): number {
  const [rupees, fraction = ""] = amount.split(".");
  return Number(rupees) * 100 + Number((fraction + "00").slice(0, 2));
}

export function PaymentDialog({
  invoice,
  busy,
  onConfirm,
  onClose,
}: {
  invoice: InvoiceRow;
  busy: boolean;
  onConfirm: (amount: string, method: string, reference: string) => void;
  onClose: () => void;
}) {
  // Seeded with the full outstanding balance, because settling an invoice is
  // the common case and a part payment is the deliberate one.
  const [amount, setAmount] = useState(invoice.dueAmount);
  const [method, setMethod] = useState<string>("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  function confirm() {
    if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
      setProblem("Enter an amount in rupees, with at most two decimal places.");
      return;
    }
    if (paise(amount) <= 0) {
      setProblem("A payment has to be a positive amount.");
      return;
    }
    if (paise(amount) > paise(invoice.dueAmount)) {
      setProblem(`That is more than the ${formatRupees(invoice.dueAmount)} outstanding.`);
      return;
    }
    onConfirm(amount, method, reference.trim());
  }

  const partial = /^\d+(\.\d{1,2})?$/.test(amount) && paise(amount) < paise(invoice.dueAmount);

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-200">
        <h3 className="text-sm font-bold text-slate-900 mb-1">
          Record payment on {invoice.invoiceNumber}
        </h3>
        <p className="text-xs text-slate-500 mb-4 leading-relaxed">
          <strong>{formatRupees(invoice.dueAmount)}</strong> outstanding of{" "}
          {formatRupees(invoice.total)}.
        </p>

        <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="payment-amount">
          Amount received (₹)
        </label>
        <input
          className="w-full text-sm font-semibold font-jetbrains rounded-lg border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/20 py-2 px-3"
          id="payment-amount"
          inputMode="decimal"
          onChange={(event) => {
            setAmount(event.target.value);
            setProblem(null);
          }}
          type="text"
          value={amount}
        />

        <label
          className="block text-xs font-semibold text-slate-700 mt-3 mb-1"
          htmlFor="payment-method"
        >
          Method
        </label>
        <select
          className="w-full text-xs font-semibold rounded-lg border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/20 py-2 px-3"
          id="payment-method"
          onChange={(event) => setMethod(event.target.value)}
          value={method}
        >
          {METHODS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <label
          className="block text-xs font-semibold text-slate-700 mt-3 mb-1"
          htmlFor="payment-reference"
        >
          Reference
        </label>
        <input
          className="w-full text-xs rounded-lg border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/20 py-2 px-3"
          id="payment-reference"
          onChange={(event) => setReference(event.target.value)}
          placeholder="UTR, cheque number, or receipt"
          type="text"
          value={reference}
        />

        {partial && !problem && (
          <p className="text-[11px] text-amber-700 mt-2 font-medium">
            A part payment. The invoice stays open for the balance.
          </p>
        )}
        {problem && <p className="text-[11px] text-rose-600 mt-2 font-medium">{problem}</p>}

        <div className="flex items-center justify-end space-x-2.5 mt-4">
          <button
            className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs transition-colors disabled:opacity-60"
            disabled={busy}
            onClick={confirm}
            type="button"
          >
            {busy ? "Recording…" : "Record Payment"}
          </button>
        </div>
      </div>
    </div>
  );
}
