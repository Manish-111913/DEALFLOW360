import type { AuthzUser } from "../authz/roles";
import { prisma } from "../db";
import { NotFoundError } from "../errors";
import { dispatchShipment, recordDelivery } from "./fulfillment";
import { assertQuotationVisible } from "./quotations";

/**
 * Dispatching a shipment, and recording that it arrived, with the caller checked.
 *
 * `dispatchShipment` and `recordDelivery` both ask `assertCan(user, "allocate")`
 * and stop there, which answers "may this kind of user dispatch at all" and
 * says nothing about *which* order. Finance/Operations holds `allocate` and its
 * row scope is real - it sees orders by stage, not every order in the database -
 * so without the second question a finance user could dispatch an order they
 * are not able to open. That is the same two-questions bug that let one rep read
 * another rep's quotation, so it is fixed the same way and in the same place:
 * inside the service, not in the route handler that happens to call it.
 *
 * The primitives keep their signatures because the seed and the fulfilment
 * tests compose them directly; these are the wrappers the product uses.
 */

/** What the screen offers as a dispatchable unit: one warehouse's reserved stock. */
export interface DispatchableGroup {
  warehouseId: string;
  warehouseName: string;
  /** Distinct order lines reserved here. */
  lineCount: number;
  /** Physical units waiting to leave this depot. */
  units: number;
}

/**
 * Warehouses with stock reserved against this order and nothing yet shipped.
 *
 * Derived from allocations rather than from the plan, because a manual override
 * may have moved units to a depot the plan never proposed - and it is the
 * reservation, not the proposal, that can actually be dispatched.
 */
export async function listDispatchable(
  user: AuthzUser,
  quotationId: string,
): Promise<DispatchableGroup[]> {
  await assertQuotationVisible(user, quotationId);

  const reserved = await prisma.fulfillmentAllocation.findMany({
    where: { quotationId, status: "RESERVED" },
    include: { warehouse: { select: { id: true, name: true } } },
  });

  const grouped = new Map<string, DispatchableGroup>();
  for (const allocation of reserved) {
    const existing = grouped.get(allocation.warehouseId) ?? {
      warehouseId: allocation.warehouse.id,
      warehouseName: allocation.warehouse.name,
      lineCount: 0,
      units: 0,
    };
    existing.lineCount += 1;
    existing.units += allocation.allocatedQuantity;
    grouped.set(allocation.warehouseId, existing);
  }

  return [...grouped.values()].sort((a, b) => a.warehouseName.localeCompare(b.warehouseName));
}

export async function dispatchShipmentAs(
  user: AuthzUser,
  input: { quotationId: string; warehouseId: string; estimatedDeliveryDate?: Date | null },
): Promise<{ shipmentId: string; shipmentNumber: string; allocations: number }> {
  await assertQuotationVisible(user, input.quotationId);

  return dispatchShipment({
    quotationId: input.quotationId,
    warehouseId: input.warehouseId,
    user,
    estimatedDeliveryDate: input.estimatedDeliveryDate ?? null,
  });
}

export async function recordDeliveryAs(
  user: AuthzUser,
  input: { shipmentId: string; deliveredAt?: Date },
): Promise<{ slipped: boolean; daysLate: number }> {
  // A shipment is only reachable through the order it belongs to, so the order
  // is what the scope check has to be about.
  const shipment = await prisma.shipment.findUnique({
    where: { id: input.shipmentId },
    select: { quotationId: true },
  });
  if (!shipment) throw new NotFoundError(`Shipment ${input.shipmentId} does not exist`);

  await assertQuotationVisible(user, shipment.quotationId);

  return recordDelivery({ shipmentId: input.shipmentId, user, deliveredAt: input.deliveredAt });
}
