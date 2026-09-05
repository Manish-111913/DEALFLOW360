import {
  assertQuotationVisible,
  getFulfillmentView,
  getQuotation,
  listQuotations,
  listWarehouses,
} from "@dealflow/backend";
import { requireInternalUser } from "@/auth";
import { FulfillmentClient } from "./_components/fulfillment-client";

/**
 * Screen 4 - Fulfillment & Warehouse Allocation.
 *
 * Fulfilment only means something once a plan exists, so the page picks the
 * most recent approved order that actually has one rather than simply the most
 * recent approved order - which is usually a quote nobody has planned yet, and
 * would render a screen of nulls.
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
    for (const candidate of candidates.slice(0, 25)) {
      const found = await getFulfillmentView(user, candidate.id);
      if (found && (found.recommended || found.allocations.length > 0)) {
        chosenId = candidate.id;
        view = found;
        break;
      }
    }
  }

  if (!chosenId || !view) return <FulfillmentClient data={null} />;

  const quotation = await getQuotation(user, chosenId);
  const header = candidates.find((row) => row.id === chosenId);

  // The override dialog writes picks keyed by warehouse id, and the plan view
  // only names warehouses - so the ids and the free stock come from here.
  const warehouses = await listWarehouses();

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
        })),
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
