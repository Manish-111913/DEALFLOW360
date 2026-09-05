"use client";

import { useMemo, useState } from "react";
import type { FulfillmentData, PlanView } from "./fulfillment-client";

/**
 * Manual Warehouse Override.
 *
 * The old version had two hardcoded inputs called "Main Warehouse" and "East
 * Depot" with their capacities written into the markup, and a target of 20
 * units. It now builds a grid from the order's real lines and the real
 * warehouses, seeded with whatever the allocator proposed, and checks each
 * quantity against that warehouse's actual free stock for that product.
 *
 * It emits `picks` in the shape `overrideAllocation` wants - line, warehouse,
 * quantity - and requires a reason, because an override is a deliberate
 * commercial act that the service records as one.
 */
export function OverrideModal({
  plan,
  orderLines,
  warehouses,
  busy,
  onApply,
  onClose,
}: {
  plan: PlanView;
  orderLines: FulfillmentData["orderLines"];
  warehouses: FulfillmentData["warehouses"];
  busy: boolean;
  onApply: (
    picks: { lineId: string; warehouseId: string; quantity: number }[],
    reason: string,
  ) => void;
  onClose: () => void;
}) {
  // Seed the grid from the recommendation, so "override" starts as "the
  // suggestion, which you may now edit" rather than an empty form.
  const [picks, setPicks] = useState<Record<string, number>>(() => {
    const seeded: Record<string, number> = {};
    for (const line of plan.lines) {
      const warehouse = warehouses.find((w) => w.name === line.warehouseName);
      if (warehouse) seeded[`${line.lineId}::${warehouse.id}`] = line.quantity;
    }
    return seeded;
  });
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const perLine = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const [key, quantity] of Object.entries(picks)) {
      const [lineId] = key.split("::");
      totals[lineId] = (totals[lineId] ?? 0) + quantity;
    }
    return totals;
  }, [picks]);

  function set(lineId: string, warehouseId: string, quantity: number) {
    setPicks((current) => ({ ...current, [`${lineId}::${warehouseId}`]: Math.max(0, quantity) }));
    if (problem) setProblem(null);
  }

  function apply() {
    if (!reason.trim()) {
      setProblem("An override needs a reason — it is recorded as a commercial decision.");
      return;
    }

    const built = Object.entries(picks)
      .filter(([, quantity]) => quantity > 0)
      .map(([key, quantity]) => {
        const [lineId, warehouseId] = key.split("::");
        return { lineId, warehouseId, quantity };
      });

    if (built.length === 0) {
      setProblem("Allocate at least one unit before applying.");
      return;
    }

    // Over-allocating a line is caught by the service too, but saying so here
    // avoids a round trip to be told something the form already knows.
    for (const line of orderLines) {
      const assigned = perLine[line.id] ?? 0;
      if (assigned > line.quantity) {
        setProblem(`${line.productName}: ${assigned} allocated against ${line.quantity} ordered.`);
        return;
      }
    }

    onApply(built, reason.trim());
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-2xl w-full overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 shrink-0">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Manual Warehouse Override</h3>
            <p className="text-xs text-slate-500">
              Adjust the dispatch split between facilities
            </p>
          </div>
          <button
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
            onClick={onClose}
            type="button"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto app-scroll">
          {orderLines.map((line) => {
            const assigned = perLine[line.id] ?? 0;
            const balanced = assigned === line.quantity;
            return (
              <div className="space-y-2" key={line.id}>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-800">{line.productName}</span>
                  <span
                    className={
                      "px-2 py-0.5 rounded font-jetbrains " +
                      (balanced
                        ? "text-emerald-700 bg-emerald-100/80"
                        : assigned > line.quantity
                          ? "text-rose-700 bg-rose-100"
                          : "text-amber-700 bg-amber-100")
                    }
                  >
                    {assigned} / {line.quantity} assigned
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {warehouses.map((warehouse) => {
                    const free = warehouse.free[line.productId] ?? 0;
                    const key = `${line.id}::${warehouse.id}`;
                    return (
                      <div className="space-y-1" key={warehouse.id}>
                        <div className="flex justify-between items-center text-[11px]">
                          <label className="font-semibold text-slate-700" htmlFor={key}>
                            {warehouse.name}
                          </label>
                          <span className="text-slate-400">Free: {free}</span>
                        </div>
                        <input
                          className="w-full text-sm font-semibold rounded-lg border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/20 py-2 px-3"
                          id={key}
                          max={free}
                          min={0}
                          onChange={(event) =>
                            set(line.id, warehouse.id, Number.parseInt(event.target.value, 10) || 0)
                          }
                          type="number"
                          value={picks[key] ?? 0}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div className="pt-2 border-t border-slate-100">
            <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="override-reason">
              Reason for override (required)
            </label>
            <textarea
              className="w-full text-xs p-2.5 rounded-lg border border-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              id="override-reason"
              onChange={(event) => {
                setReason(event.target.value);
                if (problem) setProblem(null);
              }}
              placeholder="Why is this shipping differently from the recommendation?"
              rows={2}
              value={reason}
            />
            {problem && <p className="text-[11px] text-rose-600 mt-1 font-medium">{problem}</p>}
          </div>
        </div>

        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2.5 shrink-0">
          <button
            className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-white border border-slate-300 rounded-lg"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="px-4 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm disabled:opacity-60"
            disabled={busy}
            onClick={apply}
            type="button"
          >
            {busy ? "Applying…" : "Apply Allocation Override"}
          </button>
        </div>
      </div>
    </div>
  );
}
