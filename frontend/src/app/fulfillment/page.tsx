import {
  assertQuotationVisible,
  can,
  currentBusinessTime,
  getFulfillmentView,
  getQuotation,
  listDispatchable,
  listQuotations,
  listWarehouses,
} from "@dealflow/backend";
import { requireInternalUser } from "@/auth";
import { FulfillmentClient } from "./_components/fulfillment-client";

/**
 * Screen 4 - Fulfillment & Warehouse Allocation.
 *
 * The page prefers the most recent approved order that already has a plan, and
 * falls back to the most recent that has none. Preferring a planned order keeps
 * the screen useful; falling back is what makes it reachable, because an order
 * with no plan is the one somebody came here to plan.
 *
 * `?id=` overrides, guarded by `assertQuotationVisible` because
 * `getFulfillmentView` takes an id and checks nothing itself.
 */
export default async function FulfillmentPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const user = await requireInternalUser("/fulfillment");

  const { id } = await searchParams;

  // Anything past approval can have a plan, including confirmed orders whose
  // stock is already reserved - those are exactly what "what shipped?" asks.
  const candidates = [
    ...(await listQuotations(user, { stage: "APPROVED" })),
    ...(await listQuotations(user, { stage: "FULFILLMENT" })),
  ];

  let chosenId = id ?? null;
  let view: Awaited<ReturnType<typeof getFulfillmentView>> | null = null;

  if (chosenId) {
    await assertQuotationVisible(user, chosenId);
    view = await getFulfillmentView(user, chosenId);
  } else {
    // An order that already has a plan is the screen worth opening on, so it
    // still wins. What changed is what happens when none of them does: the
    // newest planless order is shown instead of nothing at all. Skipping it
    // meant the dock landed on "no fulfilment" while an approved order sat
    // waiting to be planned, reachable only by typing its id into the URL.
    let fallbackId: string | null = null;
    let fallbackView: Awaited<ReturnType<typeof getFulfillmentView>> | null = null;

    for (const candidate of candidates.slice(0, 25)) {
      const found = await getFulfillmentView(user, candidate.id);
      if (!found) continue;
      if (found.recommended || found.allocations.length > 0) {
        chosenId = candidate.id;
        view = found;
        break;
      }
      if (!fallbackView) {
        fallbackId = candidate.id;
        fallbackView = found;
      }
    }

    if (!view) {
      chosenId = fallbackId;
      view = fallbackView;
    }
  }

  if (!chosenId || !view) return <FulfillmentClient data={null} />;

  const quotation = await getQuotation(user, chosenId);
  const header = candidates.find((row) => row.id === chosenId);

  // The override dialog writes picks keyed by warehouse id, and the plan view
  // only names warehouses - so the ids and the free stock come from here.
  const warehouses = await listWarehouses();

  // What can actually leave the building. Computed on the server from the
  // reservations rather than from the plan, because a manual override may have
  // moved units to a depot the plan never proposed.
  const dispatchable = await listDispatchable(user, chosenId);

  const plan = (source: NonNullable<typeof view>["recommended"]) =>
    source
      ? {
          planId: source.planId,
          status: source.status,
          isRunnerUp: source.isRunnerUp,
          shipmentCount: source.shipmentCount,
          shippingCost: String(source.shippingCost),
          // The allocator says why it chose this split; the screen prints that
          // rather than inventing a justification.
          rationale: source.rationale,
          lines: source.lines.map((line) => ({
            lineId: line.lineId,
            productName: line.productName,
            warehouseName: line.warehouseName,
            quantity: line.quantity,
          })),
        }
      : null;

  return (
    <FulfillmentClient
      data={{
        quotationId: chosenId,
        quoteNumber: view.quoteNumber,
        customerName: header?.customerName ?? quotation?.customer.name ?? "",
        totalAmount: header?.totalAmount ?? quotation?.totalAmount.toFixed(2) ?? "0",
        recommended: plan(view.recommended),
        alternative: plan(view.alternative),
        allocations: view.allocations.map((allocation) => ({
          id: allocation.id,
          lineId: allocation.lineId,
          productName: allocation.productName,
          warehouseName: allocation.warehouseName,
          requestedQuantity: allocation.requestedQuantity,
          allocatedQuantity: allocation.allocatedQuantity,
          status: allocation.status,
          isManualOverride: allocation.isManualOverride,
        })),
        backorders: view.backorders.map((backorder) => ({
          id: backorder.id,
          lineId: backorder.lineId,
          productName: backorder.productName,
          quantity: backorder.quantity,
          status: backorder.status,
          expectedDate: backorder.expectedDate?.toISOString() ?? null,
        })),
        shipments: view.shipments.map((shipment) => ({
          id: shipment.id,
          shipmentNumber: shipment.shipmentNumber,
          warehouseName: shipment.warehouseName,
          status: shipment.status,
          shippingCost: String(shipment.shippingCost),
          estimatedDeliveryDate: shipment.estimatedDeliveryDate?.toISOString() ?? null,
          slipped: shipment.slipped,
          delivered: shipment.actualDeliveryDate !== null,
        })),
        dispatchable,
        canAllocate: can(user, "allocate"),
        // D3: business time is the server's, so the date fields agree with the
        // timestamps the services write even in a time-travelled demo.
        businessToday: currentBusinessTime().toISOString().slice(0, 10),
        orderLines: (quotation?.lines ?? []).map((line) => ({
          id: line.id,
          productId: line.productId,
          productName: line.product.name,
          sku: line.product.sku,
          quantity: line.quantity,
        })),
        warehouses: warehouses.map((warehouse) => ({
          id: warehouse.id,
          name: warehouse.name,
          code: warehouse.code,
          shippingCost: warehouse.shippingCost,
          free: Object.fromEntries(warehouse.stock.map((row) => [row.productId, row.free])),
        })),
      }}
    />
  );
}
