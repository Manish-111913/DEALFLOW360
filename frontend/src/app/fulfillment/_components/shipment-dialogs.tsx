"use client";

import { useState } from "react";
import type { FulfillmentData } from "./fulfillment-client";

/**
 * Dispatching a shipment, and recording that it arrived.
 *
 * Both dialogs are about the same pair of dates - what we promised and what
 * actually happened - so they share a shell and differ only in what they ask.
 * The chrome below is the Manual Warehouse Override dialog's, unchanged, so the
 * three modals on this screen are the same object.
 *
 * Neither dialog reads the browser clock. D3 puts business time on the server so
 * the demo can time-travel, and a date input seeded from the host would quietly
 * disagree with every timestamp the services write. `today` comes down from the
 * page as the server's business date.
 */

function Dialog({
  title,
  subtitle,
  busy,
  confirmLabel,
  busyLabel,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  busy: boolean;
  confirmLabel: string;
  busyLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 shrink-0">
          <div>
            <h3 className="text-sm font-bold text-slate-900">{title}</h3>
            <p className="text-xs text-slate-500">{subtitle}</p>
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

        <div className="p-6 space-y-5 overflow-y-auto app-scroll">{children}</div>

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
            onClick={onConfirm}
            type="button"
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const FIELD_LABEL = "block text-xs font-semibold text-slate-700 mb-1";
const FIELD =
  "w-full text-sm font-semibold rounded-lg border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/20 py-2 px-3";

export function DispatchDialog({
  groups,
  today,
  busy,
  onDispatch,
  onClose,
}: {
  groups: FulfillmentData["dispatchable"];
  /** The server's business date, as YYYY-MM-DD. */
  today: string;
  busy: boolean;
  onDispatch: (warehouseId: string, estimatedDeliveryDate: string | null) => void;
  onClose: () => void;
}) {
  const [warehouseId, setWarehouseId] = useState(groups[0]?.warehouseId ?? "");
  const [promisedFor, setPromisedFor] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  function confirm() {
    if (!warehouseId) {
      setProblem("Choose which depot this consignment leaves from.");
      return;
    }
    if (promisedFor && promisedFor < today) {
      setProblem("A delivery cannot be promised for a date that has passed.");
      return;
    }
    onDispatch(warehouseId, promisedFor || null);
  }

  return (
    <Dialog
      busy={busy}
      busyLabel="Dispatching…"
      confirmLabel="Dispatch Consignment"
      onClose={onClose}
      onConfirm={confirm}
      subtitle="Release reserved stock from one depot as a single shipment"
      title="Dispatch Shipment"
    >
      <div className="space-y-2">
        <span className={FIELD_LABEL}>Depot</span>
        {/* One shipment per warehouse is the unit the allocator planned and
            costed, so this is a choice between depots, not between lines. */}
        <div className="space-y-2">
          {groups.map((group) => (
            <label
              className={
                "flex items-center justify-between gap-3 p-3 rounded-lg border cursor-pointer transition-colors " +
                (warehouseId === group.warehouseId
                  ? "border-indigo-300 bg-indigo-50/60"
                  : "border-slate-200 hover:bg-slate-50")
              }
              key={group.warehouseId}
            >
              <div className="flex items-center gap-2.5">
                <input
                  checked={warehouseId === group.warehouseId}
                  className="text-indigo-600 focus:ring-indigo-500/20"
                  name="dispatch-warehouse"
                  onChange={() => {
                    setWarehouseId(group.warehouseId);
                    setProblem(null);
                  }}
                  type="radio"
                  value={group.warehouseId}
                />
                <div>
                  <div className="text-xs font-bold text-slate-900">{group.warehouseName}</div>
                  <div className="text-[11px] text-slate-500">
                    {group.lineCount} reserved line{group.lineCount === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
              <span className="text-[11px] font-jetbrains font-bold text-indigo-700 bg-indigo-100/70 px-2 py-0.5 rounded">
                {group.units} units
              </span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className={FIELD_LABEL} htmlFor="promised-for">
          Promised delivery date
        </label>
        <input
          className={FIELD}
          id="promised-for"
          min={today}
          onChange={(event) => {
            setPromisedFor(event.target.value);
            setProblem(null);
          }}
          type="date"
          value={promisedFor}
        />
        {/* Worth saying plainly: without a promise there is nothing for the
            arrival to be late against, so the deal's delivery signal goes quiet. */}
        <p className="text-[11px] text-slate-500 mt-1">
          Optional, but a shipment sent without a promised date can never be flagged as late on
          the Deal Health board.
        </p>
        {problem && <p className="text-[11px] text-rose-600 mt-1 font-medium">{problem}</p>}
      </div>
    </Dialog>
  );
}

export function DeliveryDialog({
  shipment,
  today,
  busy,
  onDeliver,
  onClose,
}: {
  shipment: FulfillmentData["shipments"][number];
  today: string;
  busy: boolean;
  onDeliver: (deliveredAt: string) => void;
  onClose: () => void;
}) {
  // Defaults to today because that is the common case, but stays editable
  // because arrivals are usually keyed in after the fact - and defaulting
  // silently to "now" is exactly how a late delivery stops looking late.
  const [deliveredAt, setDeliveredAt] = useState(today);
  const [problem, setProblem] = useState<string | null>(null);

  const promised = shipment.estimatedDeliveryDate
    ? shipment.estimatedDeliveryDate.slice(0, 10)
    : null;
  const late = promised !== null && deliveredAt > promised;

  function confirm() {
    if (!deliveredAt) {
      setProblem("Enter the date the consignment arrived.");
      return;
    }
    if (deliveredAt > today) {
      setProblem("A delivery cannot be recorded for a future date.");
      return;
    }
    onDeliver(deliveredAt);
  }

  return (
    <Dialog
      busy={busy}
      busyLabel="Recording…"
      confirmLabel="Record Delivery"
      onClose={onClose}
      onConfirm={confirm}
      subtitle={`${shipment.shipmentNumber} from ${shipment.warehouseName}`}
      title="Record Delivery"
    >
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/70">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Promised</p>
          <p className="font-bold text-slate-800 mt-0.5 font-jetbrains">{promised ?? "—"}</p>
        </div>
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/70">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Status</p>
          <p className="font-bold text-slate-800 mt-0.5">{shipment.status}</p>
        </div>
      </div>

      <div>
        <label className={FIELD_LABEL} htmlFor="delivered-at">
          Arrived on
        </label>
        <input
          className={FIELD}
          id="delivered-at"
          max={today}
          onChange={(event) => {
            setDeliveredAt(event.target.value);
            setProblem(null);
          }}
          type="date"
          value={deliveredAt}
        />
        {late && (
          <p className="text-[11px] text-amber-700 mt-1 font-medium">
            This is after the promised date, so the order will be marked as slipped.
          </p>
        )}
        {problem && <p className="text-[11px] text-rose-600 mt-1 font-medium">{problem}</p>}
      </div>
    </Dialog>
  );
}
