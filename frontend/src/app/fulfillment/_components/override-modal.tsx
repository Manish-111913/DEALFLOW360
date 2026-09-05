"use client";

import { useState } from "react";

/**
 * The Manual Warehouse Override dialog.
 *
 * Two quantity inputs and a running counter that colours itself against the
 * 20-unit target: emerald when it matches, rose when it goes over, amber when
 * it is short. The dialog keeps its own draft, so cancelling leaves the page's
 * allocation alone - the source screen worked the same way, since it only wrote
 * back to the page inside `applyManualOverride`.
 */

export const TARGET_UNITS = 20;

export interface Allocation {
  main: number;
  east: number;
}

export function OverrideModal({
  allocation,
  onApply,
  onClose,
}: {
  allocation: Allocation;
  onApply: (next: Allocation) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Allocation>(allocation);

  const total = draft.main + draft.east;
  const counterStyle =
    total === TARGET_UNITS
      ? "text-emerald-700 bg-emerald-100/80"
      : total > TARGET_UNITS
        ? "text-rose-700 bg-rose-100"
        : "text-amber-700 bg-amber-100";

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 transition-opacity">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden transform transition-all">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div>
            <h3 className="text-base font-bold text-slate-900">Manual Warehouse Override</h3>
            <p className="text-xs text-slate-500">
              Adjust stock dispatch allocation between facilities manually
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

        {/* Modal Body */}
        <div className="p-6 space-y-4">
          <div className="p-3 bg-indigo-50/60 border border-indigo-100 rounded-xl flex items-center justify-between text-xs font-semibold">
            <span className="text-indigo-950">
              Target Fulfillment: <strong>{TARGET_UNITS} Units</strong>
            </span>
            <span className={"px-2 py-0.5 rounded font-mono " + counterStyle}>
              {total} / {TARGET_UNITS} Assigned
            </span>
          </div>

          <QuantityField
            id="override-wh1"
            label="Main Warehouse (West Hub)"
            max={12}
            onChange={(main) => setDraft((current) => ({ ...current, main }))}
            value={draft.main}
          />
          <QuantityField
            id="override-wh2"
            label="East Depot (Logistics Center)"
            max={8}
            onChange={(east) => setDraft((current) => ({ ...current, east }))}
            value={draft.east}
          />

          <div className="pt-2 border-t border-slate-100 flex items-center gap-2.5">
            <input
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              defaultChecked
              id="allow-partial"
              type="checkbox"
            />
            <label className="text-xs text-slate-600 cursor-pointer select-none" htmlFor="allow-partial">
              Allow partial consignment dispatch if transit delays occur
            </label>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2.5">
          <button
            className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-white border border-slate-300 rounded-lg"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="px-4 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm"
            onClick={() => onApply(draft)}
            type="button"
          >
            Apply Allocation Override
          </button>
        </div>
      </div>
    </div>
  );
}

function QuantityField({
  id,
  label,
  max,
  value,
  onChange,
}: {
  id: string;
  label: string;
  /** Shown as "Max available" and set on the input, as in the source. */
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-center text-xs">
        <label className="font-bold text-slate-700" htmlFor={id}>
          {label}
        </label>
        <span className="text-slate-400">Max available: {max} units</span>
      </div>
      <div className="relative">
        <input
          className="w-full text-sm font-semibold rounded-lg border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/20 py-2 px-3"
          id={id}
          max={max}
          min={0}
          // An empty field parses to 0, which is what parseInt(...) || 0 did.
          onChange={(event) => onChange(Number.parseInt(event.target.value, 10) || 0)}
          type="number"
          value={value}
        />
        <span className="absolute right-3 top-2 text-xs text-slate-400 font-medium">units</span>
      </div>
    </div>
  );
}
