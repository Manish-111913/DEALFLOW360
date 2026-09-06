"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  AppShell,
  AppWindow,
  StatusBar,
  WindowScroll,
} from "@/components/app-shell";
import { AppDock } from "@/components/app-dock";
import { DealAssistant } from "@/components/deal-assistant";
import { CHROME_BAR, PAGE_SUBTITLE, PAGE_TITLE, SCROLL_PADDING } from "@/components/design-tokens";
import { ToastProvider, useToast, useToastState } from "@/components/toast";
import { formatRupees } from "@/lib/money";
import { OverrideModal } from "./override-modal";
import { DeliveryDialog, DispatchDialog } from "./shipment-dialogs";

/**
 * Screen 4 - Fulfillment & Warehouse Allocation, on live data.
 *
 * The split, the shipment count and the freight are the allocator's, and so is
 * the reason it gives for choosing them. D8 says the runner-up is kept so the
 * screen can present a trade-off rather than a verdict, and it is shown here
 * beside the recommendation with its own rationale.
 *
 * The old screen had two hardcoded "scenarios" the user could toggle between to
 * fake a backorder. Backorders are real rows now, so that toggle is gone - the
 * screen shows what the allocator could not fill, or says nothing is
 * outstanding.
 */

export interface PlanLine {
  lineId: string;
  productName: string;
  warehouseName: string;
  quantity: number;
}

export interface PlanView {
  planId: string;
  status: string;
  isRunnerUp: boolean;
  shipmentCount: number;
  shippingCost: string;
  /** The allocator says why it chose this split; null on older plans. */
  rationale: string | null;
  lines: PlanLine[];
}

export interface FulfillmentData {
  quotationId: string;
  quoteNumber: string;
  customerName: string;
  totalAmount: string;
  recommended: PlanView | null;
  alternative: PlanView | null;
  allocations: {
    id: string;
    lineId: string;
    productName: string;
    warehouseName: string;
    requestedQuantity: number;
    allocatedQuantity: number;
    status: string;
    isManualOverride: boolean;
  }[];
  backorders: {
    id: string;
    lineId: string;
    productName: string;
    quantity: number;
    status: string;
    expectedDate: string | null;
  }[];
  shipments: {
    id: string;
    shipmentNumber: string;
    warehouseName: string;
    status: string;
    shippingCost: string;
    estimatedDeliveryDate: string | null;
    slipped: boolean;
    /** Nothing left to record; the row stops offering a delivery button. */
    delivered: boolean;
  }[];
  /** Depots holding stock reserved against this order and not yet shipped. */
  dispatchable: {
    warehouseId: string;
    warehouseName: string;
    lineCount: number;
    units: number;
  }[];
  orderLines: {
    id: string;
    productId: string;
    productName: string;
    sku: string;
    quantity: number;
  }[];
  /**
   * D17: Finance/Operations decides allocation and dispatch; a rep watches.
   * The same predicate the services assert with, so a button is never offered
   * that the endpoint behind it would refuse.
   */
  canAllocate: boolean;
  /**
   * The server's business date as YYYY-MM-DD, for the two date fields.
   * D3 keeps the clock on the server so the demo can time-travel; a date input
   * seeded from the browser would disagree with every timestamp we write.
   */
  businessToday: string;
  /** Ids and free stock, so the override dialog can write real picks. */
  warehouses: {
    id: string;
    name: string;
    code: string;
    shippingCost: string;
    /** Free units of each product at this warehouse, keyed by product id. */
    free: Record<string, number>;
  }[];
}

export function FulfillmentClient({ data }: { data: FulfillmentData | null }) {
  return (
    <ToastProvider>
      <Fulfillment data={data} />
    </ToastProvider>
  );
}

function Fulfillment({ data }: { data: FulfillmentData | null }) {
  const router = useRouter();
  const showToast = useToast();
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  // The shipment whose arrival is being recorded, or null. Held by id rather
  // than by object so a router refresh cannot leave a stale copy on screen.
  const [deliveringId, setDeliveringId] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const totals = useMemo(() => {
    if (!data) return { requested: 0, allocated: 0, backordered: 0 };
    const requested = data.orderLines.reduce((sum, line) => sum + line.quantity, 0);
    const allocated =
      data.allocations.length > 0
        ? data.allocations.reduce((sum, a) => sum + a.allocatedQuantity, 0)
        : (data.recommended?.lines.reduce((sum, l) => sum + l.quantity, 0) ?? 0);
    const backordered = data.backorders.reduce((sum, b) => sum + b.quantity, 0);
    return { requested, allocated, backordered };
  }, [data]);

  // Already allocated means the decision is made; the buttons stop offering it.
  const settled = (data?.allocations.length ?? 0) > 0;

  // Looked up rather than held, so a refresh that changes a shipment's status
  // is reflected in the open dialog instead of freezing the copy it opened with.
  const deliveringShipment = data?.shipments.find((row) => row.id === deliveringId) ?? null;

  function accept() {
    if (!data) return;
    startTransition(async () => {
      const response = await fetch("/api/fulfillment/allocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quotationId: data.quotationId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(body.error ?? "The allocation was not accepted");
        return;
      }
      showToast("Stock reserved against the recommended split.");
      router.refresh();
    });
  }

  /**
   * Work out how this order should ship. Advisory - nothing is reserved until
   * the split below it is accepted.
   */
  function plan() {
    if (!data) return;
    startTransition(async () => {
      const response = await fetch("/api/fulfillment/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quotationId: data.quotationId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(body.error ?? "No plan could be produced for this order");
        return;
      }
      showToast(`Plan ready — ${body.shipmentCount} shipment(s), freight ${body.shippingCost}.`);
      router.refresh();
    });
  }

  function override(picks: { lineId: string; warehouseId: string; quantity: number }[], reason: string) {
    if (!data) return;
    startTransition(async () => {
      const response = await fetch("/api/fulfillment/allocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quotationId: data.quotationId, picks, reason }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(body.error ?? "The override was not applied");
        return;
      }
      setOverrideOpen(false);
      showToast("Custom allocation applied. Stock reserved.");
      router.refresh();
    });
  }

  function dispatch(warehouseId: string, estimatedDeliveryDate: string | null) {
    if (!data) return;
    startTransition(async () => {
      const response = await fetch("/api/fulfillment/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quotationId: data.quotationId, warehouseId, estimatedDeliveryDate }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(body.error ?? "The consignment was not dispatched");
        return;
      }
      setDispatchOpen(false);
      showToast(`${body.shipmentNumber} dispatched — ${body.allocations} line(s) released.`);
      router.refresh();
    });
  }

  function deliver(shipmentId: string, deliveredAt: string) {
    startTransition(async () => {
      const response = await fetch("/api/fulfillment/deliver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipmentId, deliveredAt }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(body.error ?? "The delivery was not recorded");
        return;
      }
      setDeliveringId(null);
      showToast(
        body.slipped
          ? `Delivered ${body.daysLate} day(s) late — the deal's delivery signal has slipped.`
          : "Delivered on time.",
      );
      router.refresh();
    });
  }

  return (
    <AppShell className="screen-fulfillment font-jakarta bg-[#f0f4f8] text-slate-800 selection:bg-indigo-100 selection:text-indigo-800">
      <AppWindow>
        <header className={CHROME_BAR}>
          {/* Spacing, traffic-light colours and title weight all match
              Subscription & Billing exactly. This bar had drifted to its own
              palette and a heavier title, which is the kind of difference that
              reads as a different application rather than a different page. */}
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-1.5">
              <span className="w-3 h-3 rounded-full bg-[#ff5f56] inline-block shadow-sm" />
              <span className="w-3 h-3 rounded-full bg-[#ffbd2e] inline-block shadow-sm" />
              <span className="w-3 h-3 rounded-full bg-[#27c93f] inline-block shadow-sm" />
            </div>
            <div className="h-4 w-px bg-slate-300" />
            <div className="text-xs font-medium text-slate-600">
              Sales Operations &amp; Fulfillment
            </div>
          </div>
        </header>

        <WindowScroll className={SCROLL_PADDING}>
          {data === null ? (
            <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs p-8 text-center">
              <p className="text-sm font-bold text-slate-900">No order is waiting on allocation</p>
              <p className="text-xs text-slate-500 mt-1">
                A fulfilment plan is produced once an order is approved. Approve a quotation, or run
                <span className="font-jetbrains"> npm run db:seed:demo </span>
                to restore the demo order.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h1 className={PAGE_TITLE}>Fulfillment &amp; Warehouse Allocation</h1>
                    <span
                      className={
                        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border " +
                        (settled
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-amber-50 text-amber-700 border-amber-200")
                      }
                    >
                      <span
                        className={
                          "w-1.5 h-1.5 rounded-full mr-1.5 " +
                          (settled ? "bg-emerald-500" : "bg-amber-500")
                        }
                      />
                      {settled ? "Stock Reserved" : "Awaiting Allocation"}
                    </span>
                  </div>
                  <p className={PAGE_SUBTITLE}>
                    Customer: <strong className="text-slate-800">{data.customerName}</strong> · Ref{" "}
                    <span className="font-jetbrains text-indigo-600">{data.quoteNumber}</span> ·{" "}
                    {formatRupees(data.totalAmount)}
                  </p>
                </div>

                {/* D17 again: a rep may watch fulfilment but never decide it,
                    so the decisions are not offered to them at all. The screen
                    previously showed these to everyone and let the endpoint
                    return 403, which reads as a broken button. */}
                {data.canAllocate && !settled && data.recommended && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg shadow-xs transition-colors disabled:opacity-60"
                      disabled={busy}
                      onClick={() => setOverrideOpen(true)}
                      type="button"
                    >
                      Manual Override
                    </button>
                    <button
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-colors disabled:opacity-60"
                      disabled={busy}
                      onClick={accept}
                      type="button"
                    >
                      {busy ? "Reserving…" : "Accept Suggested Split"}
                    </button>
                  </div>
                )}

                {/* Once stock is reserved the next decision is when it leaves. */}
                {data.canAllocate && data.dispatchable.length > 0 && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-colors disabled:opacity-60"
                      disabled={busy}
                      onClick={() => setDispatchOpen(true)}
                      type="button"
                    >
                      Dispatch Shipment
                    </button>
                  </div>
                )}
              </div>

              {/* Metrics, all derived from the plan and the order */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-white p-4 rounded-xl border border-slate-200/90 shadow-2xs">
                <Metric label="Total Requested" value={`${totals.requested}`} unit="units" />
                <Metric
                  label="Allocated"
                  tone={totals.backordered > 0 ? "amber" : "emerald"}
                  unit={`units (${totals.requested ? Math.round((totals.allocated / totals.requested) * 100) : 0}%)`}
                  value={`${totals.allocated}`}
                />
                <Metric
                  label="Backordered"
                  tone={totals.backordered > 0 ? "amber" : "slate"}
                  unit="units"
                  value={`${totals.backordered}`}
                />
                <Metric
                  label="Logistics Freight"
                  mono
                  tone="indigo"
                  unit="est."
                  value={formatRupees(data.recommended?.shippingCost ?? "0")}
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <section className="lg:col-span-8 flex flex-col gap-6">
                  {data.recommended ? (
                    <PlanCard
                      overridden={data.allocations.some((a) => a.isManualOverride)}
                      plan={data.recommended}
                      settled={settled}
                      title="Recommended Warehouse Allocation"
                    />
                  ) : (
                    <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs p-6 text-center">
                      <p className="text-xs text-slate-500">
                        No plan has been produced for this order yet.
                      </p>
                      {/* The way out of this state. Orders confirmed in the
                          portal are planned automatically; one approved but not
                          yet confirmed is planned from here. */}
                      {data.canAllocate && !settled && (
                        <button
                          className="mt-3 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-colors disabled:opacity-60"
                          disabled={busy}
                          onClick={plan}
                          type="button"
                        >
                          {busy ? "Working out the split…" : "Produce Allocation Plan"}
                        </button>
                      )}
                    </div>
                  )}

                  {/* D8: the runner-up, so this reads as a choice not a verdict */}
                  {data.alternative && (
                    <PlanCard
                      muted
                      plan={data.alternative}
                      settled={settled}
                      title="Runner-up Plan"
                    />
                  )}

                  <OrderItems lines={data.orderLines} />
                </section>

                <aside className="lg:col-span-4 flex flex-col gap-6">
                  <Summary
                    allocated={totals.allocated}
                    backordered={totals.backordered}
                    freight={data.recommended?.shippingCost ?? "0"}
                    quoteNumber={data.quoteNumber}
                    requested={totals.requested}
                    shipments={data.recommended?.shipmentCount ?? 0}
                  />

                  {data.backorders.length > 0 && <Backorders rows={data.backorders} />}
                  {data.shipments.length > 0 && (
                    <Shipments
                      busy={busy}
                      canRecord={data.canAllocate}
                      onRecordDelivery={setDeliveringId}
                      rows={data.shipments}
                    />
                  )}
                  {data.allocations.length > 0 && <Allocations rows={data.allocations} />}
                </aside>
              </div>
            </>
          )}
        </WindowScroll>

        <StatusBar />
      </AppWindow>

      <AppDock />
      <DealAssistant
        quotationId={data?.quotationId ?? null}
        screen="fulfillment"
        subject={data ? `${data.quoteNumber} - ${data.customerName}` : null}
      />
      <FulfillmentToast />

      {overrideOpen && data?.recommended && (
        <OverrideModal
          busy={busy}
          onApply={override}
          onClose={() => setOverrideOpen(false)}
          orderLines={data.orderLines}
          plan={data.recommended}
          warehouses={data.warehouses}
        />
      )}

      {dispatchOpen && data && data.dispatchable.length > 0 && (
        <DispatchDialog
          busy={busy}
          groups={data.dispatchable}
          onClose={() => setDispatchOpen(false)}
          onDispatch={dispatch}
          today={data.businessToday}
        />
      )}

      {deliveringShipment && data && (
        <DeliveryDialog
          busy={busy}
          onClose={() => setDeliveringId(null)}
          onDeliver={(deliveredAt) => deliver(deliveringShipment.id, deliveredAt)}
          shipment={deliveringShipment}
          today={data.businessToday}
        />
      )}
    </AppShell>
  );
}

function Metric({
  label,
  value,
  unit,
  tone = "slate",
  mono,
}: {
  label: string;
  value: string;
  unit: string;
  tone?: "slate" | "emerald" | "amber" | "indigo";
  mono?: boolean;
}) {
  const colour = {
    slate: "text-slate-900",
    emerald: "text-emerald-600",
    amber: "text-amber-600",
    indigo: "text-indigo-700",
  }[tone];

  return (
    <div className="px-2">
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={"text-xl font-bold mt-1 " + colour + (mono ? " font-jetbrains" : "")}>
        {value} <span className="text-xs font-normal text-slate-500">{unit}</span>
      </p>
    </div>
  );
}

function PlanCard({
  title,
  plan,
  settled,
  muted,
  overridden,
}: {
  title: string;
  plan: PlanView;
  settled: boolean;
  muted?: boolean;
  overridden?: boolean;
}) {
  // One row per warehouse, since the plan lists a line per warehouse split.
  const byWarehouse = new Map<string, number>();
  for (const line of plan.lines) {
    byWarehouse.set(line.warehouseName, (byWarehouse.get(line.warehouseName) ?? 0) + line.quantity);
  }
  const total = [...byWarehouse.values()].reduce((sum, n) => sum + n, 0);

  return (
    <div
      className={
        "bg-white rounded-xl border shadow-2xs overflow-hidden flex flex-col " +
        (muted ? "border-slate-200/70" : "border-slate-200/90")
      }
    >
      <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-900">{title}</h2>
            {!muted && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-600 border border-indigo-200">
                Algorithm Optimized
              </span>
            )}
            {overridden && !muted && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                Manually overridden
              </span>
            )}
          </div>
          {/* The allocator's own justification for this split. */}
          <p className="text-xs text-slate-500 mt-0.5">{plan.rationale ?? "No rationale recorded."}</p>
        </div>
        <div className="shrink-0 text-[11px] font-semibold text-slate-500 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-md">
          {plan.shipmentCount} shipment{plan.shipmentCount === 1 ? "" : "s"} ·{" "}
          {formatRupees(plan.shippingCost)}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50/75 border-b border-slate-100 text-slate-600 uppercase text-[10px] tracking-wider font-semibold">
            <tr>
              <th className="py-3 px-5">Warehouse Depot</th>
              <th className="py-3 px-4">Allocated Qty</th>
              <th className="py-3 px-4">Share</th>
              <th className="py-3 px-5 text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
            {[...byWarehouse.entries()].map(([warehouse, quantity], index) => (
              <tr className="hover:bg-slate-50/50 transition-colors" key={warehouse}>
                <td className="py-3.5 px-5">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={
                        "w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs border " +
                        (index === 0
                          ? "bg-indigo-50 text-indigo-600 border-indigo-100"
                          : "bg-sky-50 text-sky-600 border-sky-100")
                      }
                    >
                      W{index + 1}
                    </div>
                    <div className="font-bold text-slate-900 text-xs">{warehouse}</div>
                  </div>
                </td>
                <td className="py-3.5 px-4">
                  <span
                    className={
                      "font-bold border px-2 py-0.5 rounded " +
                      (index === 0
                        ? "text-indigo-700 bg-indigo-50 border-indigo-200"
                        : "text-sky-700 bg-sky-50 border-sky-200")
                    }
                  >
                    {quantity} allocated
                  </span>
                </td>
                <td className="py-3.5 px-4 text-slate-600 font-jetbrains">
                  {total ? Math.round((quantity / total) * 100) : 0}%
                </td>
                <td className="py-3.5 px-5 text-right">
                  <span
                    className={
                      "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border " +
                      (settled && !muted
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-slate-100 text-slate-600 border-slate-200")
                    }
                  >
                    {settled && !muted ? "● Reserved" : "● Proposed"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="p-5 bg-slate-50/60 border-t border-slate-100">
        <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden flex">
          {[...byWarehouse.entries()].map(([warehouse, quantity], index) => (
            <div
              className={"h-full transition-all duration-500 " + (index === 0 ? "bg-indigo-600" : "bg-sky-500")}
              key={warehouse}
              style={{ width: (total ? (quantity / total) * 100 : 0) + "%" }}
              title={`${warehouse}: ${quantity} units`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function OrderItems({ lines }: { lines: FulfillmentData["orderLines"] }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs p-5">
      <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2.5">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
          Order Items Breakdown
        </h3>
        <span className="text-xs text-slate-400">
          {lines.length} SKU line item{lines.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="divide-y divide-slate-100">
        {lines.map((line) => (
          <div className="py-3 flex items-center justify-between text-xs" key={line.id}>
            <div>
              <span className="font-bold text-slate-800">{line.productName}</span>
              <span className="text-slate-400 block text-[11px]">SKU: {line.sku}</span>
            </div>
            <span className="font-bold text-slate-800">{line.quantity} units</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Summary({
  quoteNumber,
  requested,
  allocated,
  backordered,
  shipments,
  freight,
}: {
  quoteNumber: string;
  requested: number;
  allocated: number;
  backordered: number;
  shipments: number;
  freight: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs p-5">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
          Fulfillment Summary
        </h3>
        <span className="text-[10px] font-jetbrains font-bold bg-slate-100 px-2 py-0.5 rounded text-slate-600">
          {quoteNumber}
        </span>
      </div>
      <dl className="space-y-2.5 text-xs">
        <Row label="Requested Physical Units" value={String(requested)} />
        <Row label="Total Allocated" tone="text-emerald-600" value={String(allocated)} />
        <Row
          label="Remaining Unallocated"
          tone={backordered > 0 ? "text-amber-600" : "text-slate-700"}
          value={backordered > 0 ? `${backordered} (Backordered)` : "0"}
        />
        <Row label="Consolidated Consignments" value={`${shipments} Shipment${shipments === 1 ? "" : "s"}`} />
        <div className="border-t border-slate-100 pt-2.5 flex justify-between items-center text-sm">
          <dt className="font-bold text-slate-900">Total Freight Cost</dt>
          <dd className="font-extrabold text-indigo-600 text-base font-jetbrains">
            {formatRupees(freight)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function Row({ label, value, tone = "text-slate-800" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className={"font-bold " + tone}>{value}</dd>
    </div>
  );
}

function Backorders({ rows }: { rows: FulfillmentData["backorders"] }) {
  return (
    <div className="bg-amber-50/90 border border-amber-200 rounded-xl p-4">
      <h3 className="text-xs font-bold uppercase tracking-wider text-amber-900 mb-2">
        Backorder Notice
      </h3>
      <div className="space-y-2">
        {rows.map((row) => (
          <div className="text-[11px] text-amber-800" key={row.id}>
            <strong>{row.quantity} × {row.productName}</strong> could not be filled from network
            inventory
            {row.expectedDate
              ? ` · expected ${new Date(row.expectedDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`
              : ""}
            .
          </div>
        ))}
      </div>
    </div>
  );
}

function Shipments({
  rows,
  canRecord,
  busy,
  onRecordDelivery,
}: {
  rows: FulfillmentData["shipments"];
  canRecord: boolean;
  busy: boolean;
  onRecordDelivery: (shipmentId: string) => void;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs p-5">
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-3.5">
        Routing &amp; Carrier Dispatch
      </h3>
      <div className="space-y-3">
        {rows.map((shipment) => (
          <div
            className="p-3 bg-slate-50/80 border border-slate-200/70 rounded-xl"
            key={shipment.id}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-bold text-xs text-slate-900">{shipment.warehouseName}</span>
              <span
                className={
                  "text-[10px] font-bold px-1.5 py-0.5 rounded " +
                  (shipment.slipped
                    ? "text-rose-700 bg-rose-100/60"
                    : "text-emerald-700 bg-emerald-100/60")
                }
              >
                {shipment.slipped ? "Slipped" : shipment.status}
              </span>
            </div>
            <div className="text-[11px] text-slate-500 flex items-center justify-between">
              <span className="font-jetbrains">{shipment.shipmentNumber}</span>
              <span>{formatRupees(shipment.shippingCost)}</span>
            </div>
            {shipment.estimatedDeliveryDate && (
              <div className="text-[11px] text-slate-500 mt-1">
                Promised{" "}
                <span className="font-jetbrains text-slate-600">
                  {shipment.estimatedDeliveryDate.slice(0, 10)}
                </span>
              </div>
            )}
            {/* Delivered is the end of the road for a consignment, so the row
                states the outcome instead of offering the action again. */}
            {canRecord && !shipment.delivered && (
              <button
                className="mt-2.5 w-full px-3 py-1.5 text-[11px] font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg shadow-xs transition-colors disabled:opacity-60"
                disabled={busy}
                onClick={() => onRecordDelivery(shipment.id)}
                type="button"
              >
                Record Delivery
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Allocations({ rows }: { rows: FulfillmentData["allocations"] }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs p-5">
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-3">
        Reserved Stock
      </h3>
      <div className="space-y-2 text-xs">
        {rows.map((row) => (
          <div className="flex items-center justify-between gap-2" key={row.id}>
            <span className="text-slate-600 truncate">
              {row.productName} · {row.warehouseName}
            </span>
            <span className="font-bold text-slate-800 shrink-0">
              {row.allocatedQuantity}/{row.requestedQuantity}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FulfillmentToast() {
  const { message, visible } = useToastState();
  return (
    <div
      className={
        "fixed bottom-20 right-6 z-50 bg-slate-900 text-white text-xs px-4 py-2.5 rounded-xl shadow-2xl transition-all duration-200 " +
        (visible ? "opacity-100" : "opacity-0 pointer-events-none translate-y-4")
      }
    >
      {message}
    </div>
  );
}
