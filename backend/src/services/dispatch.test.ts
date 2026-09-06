import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthzUser } from "../authz/roles";
import { ForbiddenError } from "../authz/roles";
import { prisma } from "../db";
import { dispatchShipmentAs, listDispatchable, recordDeliveryAs } from "./dispatch";
import { allocateFulfillment } from "./fulfillment";
import { addQuotationLine, createQuotation } from "./quotations";

/**
 * Dispatch and delivery, with the caller checked against the order.
 *
 * The primitives ask only whether the caller holds `allocate`. Finance holds it
 * and is scoped by stage, so the case that matters is a finance user reaching an
 * order that has not got to them - a draft - which the capability check alone
 * would happily let through.
 */

let acmeId: string;
let repId: string;
let laptopId: string;
let mainId: string;
let finance: AuthzUser;
let rep: AuthzUser;

const created: string[] = [];

/** An approved order for N laptops, which is what Finance can see and act on. */
async function approvedOrder(quantity: number): Promise<string> {
  const q = await createQuotation({ customerId: acmeId, salesRepId: repId });
  created.push(q.id);
  await addQuotationLine({
    quotationId: q.id,
    productId: laptopId,
    quantity,
    discountPercentage: "5.00",
  });
  await prisma.quotation.update({
    where: { id: q.id },
    data: { approvalState: "APPROVED", status: "CONFIRMED" },
  });
  return q.id;
}

async function resetStock() {
  await prisma.warehouseStock.updateMany({
    where: { productId: laptopId },
    data: { availableQuantity: 40, reservedQuantity: 0 },
  });
}

beforeAll(async () => {
  acmeId = (await prisma.customer.findUniqueOrThrow({ where: { name: "Acme Industries" } })).id;
  const r = await prisma.user.findUniqueOrThrow({ where: { email: "priya@dealflow360.test" } });
  const f = await prisma.user.findUniqueOrThrow({ where: { email: "finance@dealflow360.test" } });
  repId = r.id;
  rep = { id: r.id, kind: "INTERNAL", role: "SALES_REP", customerId: null, salesTeamId: r.salesTeamId };
  finance = { id: f.id, kind: "INTERNAL", role: "FINANCE_OPS", customerId: null, salesTeamId: null };

  laptopId = (await prisma.product.findUniqueOrThrow({ where: { sku: "HW-LAPTOP-PRO" } })).id;
  mainId = (await prisma.warehouse.findUniqueOrThrow({ where: { code: "MAIN" } })).id;
});

beforeEach(async () => {
  await prisma.shipment.deleteMany({ where: { quotationId: { in: created } } });
  await prisma.fulfillmentAllocation.deleteMany({ where: { quotationId: { in: created } } });
  await prisma.backorder.deleteMany({ where: { quotationId: { in: created } } });
  await resetStock();
});

afterAll(async () => {
  await prisma.quotation.deleteMany({ where: { id: { in: created } } });
  await resetStock();
  await prisma.$disconnect();
});

describe("what can be dispatched", () => {
  it("groups reserved stock by depot", async () => {
    const quotationId = await approvedOrder(6);
    await allocateFulfillment({ quotationId, user: finance });

    const groups = await listDispatchable(finance, quotationId);
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.reduce((sum, g) => sum + g.units, 0)).toBe(6);
  });

  it("is empty before anything is reserved", async () => {
    const quotationId = await approvedOrder(4);
    expect(await listDispatchable(finance, quotationId)).toEqual([]);
  });
});

describe("dispatching", () => {
  it("ships what is reserved and stops offering it", async () => {
    const quotationId = await approvedOrder(5);
    await allocateFulfillment({ quotationId, user: finance });

    const [group] = await listDispatchable(finance, quotationId);
    const shipment = await dispatchShipmentAs(finance, {
      quotationId,
      warehouseId: group.warehouseId,
      estimatedDeliveryDate: new Date(Date.UTC(2026, 8, 20)),
    });

    expect(shipment.shipmentNumber).toMatch(/^SHP-/);
    expect(shipment.allocations).toBeGreaterThan(0);

    // Dispatched stock has left the building, so it is no longer dispatchable.
    const remaining = await listDispatchable(finance, quotationId);
    expect(remaining.find((g) => g.warehouseId === group.warehouseId)).toBeUndefined();
  });

  it("refuses a rep, who watches fulfilment but never decides it (D17)", async () => {
    const quotationId = await approvedOrder(3);
    await allocateFulfillment({ quotationId, user: finance });
    const [group] = await listDispatchable(finance, quotationId);

    await expect(
      dispatchShipmentAs(rep, { quotationId, warehouseId: group.warehouseId }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses an order Finance cannot see, even though it holds the capability", async () => {
    // A draft has not reached Finance, whose scope is by stage rather than by
    // ownership. The capability check alone would let this through - this is
    // the whole reason the wrapper exists.
    const draft = await createQuotation({ customerId: acmeId, salesRepId: repId });
    created.push(draft.id);

    await expect(
      dispatchShipmentAs(finance, { quotationId: draft.id, warehouseId: mainId }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("refuses a depot holding nothing for this order", async () => {
    const quotationId = await approvedOrder(2);
    await allocateFulfillment({ quotationId, user: finance });
    await dispatchShipmentAs(finance, {
      quotationId,
      warehouseId: (await listDispatchable(finance, quotationId))[0].warehouseId,
    });

    await expect(
      dispatchShipmentAs(finance, { quotationId, warehouseId: mainId }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("recording delivery", () => {
  async function dispatched(promisedFor: Date) {
    const quotationId = await approvedOrder(4);
    await allocateFulfillment({ quotationId, user: finance });
    const [group] = await listDispatchable(finance, quotationId);
    return dispatchShipmentAs(finance, {
      quotationId,
      warehouseId: group.warehouseId,
      estimatedDeliveryDate: promisedFor,
    });
  }

  it("records an on-time arrival as on time", async () => {
    const shipment = await dispatched(new Date(Date.UTC(2030, 0, 10)));
    const result = await recordDeliveryAs(finance, {
      shipmentId: shipment.shipmentId,
      deliveredAt: new Date(Date.UTC(2030, 0, 9)),
    });
    expect(result.slipped).toBe(false);
    expect(result.daysLate).toBe(0);
  });

  it("counts the days when it arrives late", async () => {
    const shipment = await dispatched(new Date(Date.UTC(2030, 0, 10)));
    const result = await recordDeliveryAs(finance, {
      shipmentId: shipment.shipmentId,
      deliveredAt: new Date(Date.UTC(2030, 0, 13)),
    });
    expect(result.slipped).toBe(true);
    expect(result.daysLate).toBe(3);
  });

  it("refuses to record the same arrival twice", async () => {
    const shipment = await dispatched(new Date(Date.UTC(2030, 0, 10)));
    await recordDeliveryAs(finance, { shipmentId: shipment.shipmentId });
    await expect(
      recordDeliveryAs(finance, { shipmentId: shipment.shipmentId }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("refuses a rep", async () => {
    const shipment = await dispatched(new Date(Date.UTC(2030, 0, 10)));
    await expect(
      recordDeliveryAs(rep, { shipmentId: shipment.shipmentId }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a shipment that does not exist", async () => {
    await expect(
      recordDeliveryAs(finance, { shipmentId: "nope" }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
