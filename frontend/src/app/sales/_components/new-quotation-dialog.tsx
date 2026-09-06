"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * New Quotation.
 *
 * The dialog does no commercial thinking. It picks a customer, the server
 * creates an empty DRAFT owned by whoever is allowed to own it, and the
 * builder takes over from there - lines, pricing and the recompute chain all
 * happen against the real quotation rather than in a local draft that has to
 * be reconciled later.
 *
 * The customer list is fetched rather than passed down because it is scoped to
 * the caller: a rep is offered their own accounts and unassigned ones, and
 * never another rep's book. Fetching it on open also means the list is current
 * when someone opens the dialog, not when the page was last rendered.
 */

interface Customer {
  id: string;
  name: string;
  tier: string | null;
}

type Load =
  | { status: "loading" }
  | { status: "ready"; customers: Customer[] }
  | { status: "failed"; message: string };

export function NewQuotationDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [customerId, setCustomerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/catalog", { cache: "no-store" });
        const body = (await response.json().catch(() => null)) as
          | { customers?: Customer[]; error?: string }
          | null;

        if (cancelled) return;
        if (!response.ok || !body?.customers) {
          setLoad({ status: "failed", message: body?.error ?? "Could not load customers." });
          return;
        }
        setLoad({ status: "ready", customers: body.customers });
        // Preselect, so the common case is one click.
        if (body.customers[0]) setCustomerId(body.customers[0].id);
      } catch {
        if (!cancelled) setLoad({ status: "failed", message: "Could not load customers." });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function create() {
    if (!customerId || busy) return;
    setBusy(true);
    setProblem(null);

    try {
      const response = await fetch("/api/quotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId }),
      });
      const body = (await response.json().catch(() => null)) as
        | { id?: string; quoteNumber?: string; error?: string }
        | null;

      if (!response.ok || !body?.id) {
        // A customer with no tier, or an inactive one, is refused by the
        // service with a reason worth showing rather than swallowing.
        setProblem(body?.error ?? "That quotation could not be created.");
        setBusy(false);
        return;
      }

      // Straight into the builder on the new deal.
      onClose();
      router.push(`/sales?open=${body.id}`);
      router.refresh();
    } catch {
      setProblem("That quotation could not be created.");
      setBusy(false);
    }
  }

  return (
    <div
      aria-label="New quotation"
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
      role="dialog"
    >
      <div className="bg-white rounded-2xl w-full max-w-md border border-slate-200 shadow-2xl">
        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-sm font-bold text-slate-900">New Quotation</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Choose the account. You will add products next.
            </p>
          </div>
          <button
            aria-label="Close"
            className="text-slate-400 hover:text-slate-600 p-0.5"
            onClick={onClose}
            type="button"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {load.status === "loading" && (
            <div className="space-y-2 animate-pulse" aria-label="Loading customers">
              <div className="h-2.5 rounded bg-slate-100 w-1/3" />
              <div className="h-9 rounded-lg bg-slate-100" />
            </div>
          )}

          {load.status === "failed" && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              {load.message}
            </p>
          )}

          {load.status === "ready" && load.customers.length === 0 && (
            <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-relaxed">
              No account is available to quote. An account needs a tier set before it can be
              quoted, because discount ceilings are resolved from it.
            </p>
          )}

          {load.status === "ready" && load.customers.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="customer">
                Customer
              </label>
              <select
                className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                id="customer"
                onChange={(event) => setCustomerId(event.target.value)}
                value={customerId}
              >
                {load.customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                    {customer.tier ? ` — ${customer.tier}` : ""}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-400 mt-1.5">
                Only accounts you can quote are listed.
              </p>
            </div>
          )}

          {problem && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2" role="alert">
              {problem}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-slate-100">
          <button
            className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50"
            disabled={busy || load.status !== "ready" || !customerId}
            onClick={create}
            type="button"
          >
            {busy ? "Creating…" : "Create Quotation"}
          </button>
        </div>
      </div>
    </div>
  );
}
