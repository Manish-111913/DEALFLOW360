import { afterAll, beforeEach, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "../generated/prisma/client";
import { auditTrailFor } from "../audit";
import { ForbiddenError, type AuthzUser } from "../authz/roles";
import { prisma } from "../db";
import { ConflictError, ValidationError } from "../errors";
import {
  allocateFulfillment,
  consolidateBackorder,
  findConsolidatableBackorders,
  overrideAllocation,
  planFulfillment,
  receiveStock,
} from "./fulfillment";
import { addQuotationLine, createQuotation, recomputeQuotation } from "./quotations";

const D = (v: string | number) => new Prisma.Decimal(v);

let acmeId: string;
let repId: string;
let laptopId: string;
let mainId: string;
let eastId: string;
let finance: AuthzUser;
let rep: AuthzUser;
const created: string[] = [];

/** An approved quotation for N laptops, ready to allocate. */
async function approvedOrder(quantity: number) {
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

/** Put the two warehouses back to the worked-example levels. */
async function resetStock(main = 12, east = 8) {
  await prisma.warehouseStock.updateMany({
    where: { warehouseId: mainId, productId: laptopId },
    data: { availableQuantity: main, reservedQuantity: 0 },
  });
  await prisma.warehouseStock.updateMany({
    where: { warehouseId: eastId, productId: laptopId },
    data: { availableQuantity: east, reservedQuantity: 0 },
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
  eastId = (await prisma.warehouse.findUniqueOrThrow({ where: { code: "EAST" } })).id;
});

beforeEach(async () => {
  // Backorders and reservations are warehouse-wide by design: a stock receipt
  // should surface every order it could unblock. That makes leftovers from an
  // earlier test visible to a later one, so each test starts from a clean slate.
  await prisma.backorder.deleteMany({ where: { quotationId: { in: created } } });
  await prisma.fulfillmentAllocation.deleteMany({ where: { quotationId: { in: created } } });
  await resetStock();
});

afterAll(async () => {
  await prisma.quotation.deleteMany({ where: { id: { in: created } } });
  await resetStock();
  await prisma.$disconnect();
});

describe("the frozen scenario: 20 units against 12 and 8", () => {
  it("recommends 12 from Main and 8 from East, two shipments at 370", async () => {
    const quotationId = await approvedOrder(20);
    const plan = await planFulfillment(quotationId);

    expect(plan.recommended.shipmentCount).toBe(2);
    expect(plan.recommended.shippingCost.equals(D(370))).toBe(true);
    expect(plan.recommended.shortfalls).toEqual([]);

    const fromMain = plan.recommended.picks.find((p) => p.warehouseId === mainId);
    const fromEast = plan.recommended.picks.find((p) => p.warehouseId === eastId);
    expect(fromMain?.quantity).toBe(12);
    expect(fromEast?.quantity).toBe(8);
  });

  // D4 - the pre-flight is advisory. Reserving here would hold inventory
  // hostage to a draft nobody has approved.
  it("reserves nothing", async () => {
    const quotationId = await approvedOrder(20);
    await planFulfillment(quotationId);

    const stock = await prisma.warehouseStock.findMany({ where: { productId: laptopId } });
    for (const row of stock) {
      expect(row.reservedQuantity).toBe(0);
    }
  });

  it("records the stock snapshot time, so the screen can say how fresh it is", async () => {
    const quotationId = await approvedOrder(20);
    const plan = await planFulfillment(quotationId);

    const saved = await prisma.fulfillmentPlan.findUniqueOrThrow({ where: { id: plan.planId } });
    expect(saved.stockSnapshotAt).toBeInstanceOf(Date);
    expect(saved.status).toBe("RECOMMENDED");
  });
});

describe("the frozen shortage scenario: 25 units", () => {
  it("allocates 12 and 8 and opens a 5-unit backorder", async () => {
    const quotationId = await approvedOrder(25);
    const result = await allocateFulfillment({ quotationId, user: finance });

    expect(result.shipmentCount).toBe(2);
    expect(result.backorders).toEqual([expect.objectContaining({ quantity: 5 })]);

    const backorders = await prisma.backorder.findMany({ where: { quotationId } });
    expect(backorders).toHaveLength(1);
    expect(backorders[0].quantity).toBe(5);
    expect(backorders[0].status).toBe("OPEN");
  });
});

describe("allocation reserves stock (D4)", () => {
  it("moves units into reserved rather than deleting them", async () => {
    const quotationId = await approvedOrder(20);
    await allocateFulfillment({ quotationId, user: finance });

    const main = await prisma.warehouseStock.findFirstOrThrow({
      where: { warehouseId: mainId, productId: laptopId },
    });
    const east = await prisma.warehouseStock.findFirstOrThrow({
      where: { warehouseId: eastId, productId: laptopId },
    });

    expect(main.availableQuantity).toBe(12);
    expect(main.reservedQuantity).toBe(12);
    expect(east.reservedQuantity).toBe(8);
  });

  it("refuses to allocate a quotation that is not approved", async () => {
    const q = await createQuotation({ customerId: acmeId, salesRepId: repId });
    created.push(q.id);
    await addQuotationLine({ quotationId: q.id, productId: laptopId, quantity: 1 });

    await expect(
      allocateFulfillment({ quotationId: q.id, user: finance }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses to allocate the same quotation twice", async () => {
    const quotationId = await approvedOrder(5);
    await allocateFulfillment({ quotationId, user: finance });

    await expect(
      allocateFulfillment({ quotationId, user: finance }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  // D17 - Finance owns allocation; a rep watches but does not decide.
  it("refuses a Sales Rep", async () => {
    const quotationId = await approvedOrder(5);
    await expect(
      allocateFulfillment({ quotationId, user: rep }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

/**
 * D13 - two orders confirmed at the same moment must not both claim the same
 * units. The stock rows are locked FOR UPDATE inside the transaction, in a
 * deterministic id order so concurrent allocations cannot deadlock.
 */
describe("concurrent allocation cannot oversell", () => {
  it("gives the units to one order and backorders the other", async () => {
    await resetStock(12, 8); // 20 units in total
    const first = await approvedOrder(12);
    const second = await approvedOrder(12);

    await Promise.all([
      allocateFulfillment({ quotationId: first, user: finance }),
      allocateFulfillment({ quotationId: second, user: finance }),
    ]);

    const allocations = await prisma.fulfillmentAllocation.findMany({
      where: { quotationId: { in: [first, second] } },
    });
    const totalAllocated = allocations.reduce((acc, a) => acc + a.allocatedQuantity, 0);

    // Never more than exists.
    expect(totalAllocated).toBeLessThanOrEqual(20);

    const backordered = await prisma.backorder.findMany({
      where: { quotationId: { in: [first, second] } },
    });
    const totalBackordered = backordered.reduce((acc, b) => acc + b.quantity, 0);

    // And nothing is lost: 24 requested = allocated + backordered.
    expect(totalAllocated + totalBackordered).toBe(24);

    const stock = await prisma.warehouseStock.findMany({ where: { productId: laptopId } });
    for (const row of stock) {
      expect(row.reservedQuantity).toBeLessThanOrEqual(row.availableQuantity);
    }
  });
});

describe("manual override", () => {
  it("is flagged and audited alongside the original recommendation", async () => {
    const quotationId = await approvedOrder(10);
    const line = await prisma.quotationLine.findFirstOrThrow({ where: { quotationId } });

    // The system would take all 10 from Main in one shipment; the operator
    // deliberately splits instead.
    const result = await overrideAllocation({
      quotationId,
      user: finance,
      picks: [
        { lineId: line.id, warehouseId: mainId, quantity: 4 },
        { lineId: line.id, warehouseId: eastId, quantity: 6 },
      ],
      reason: "East Depot is closer to the customer site",
    });

    expect(result.shipmentCount).toBe(2);

    const allocations = await prisma.fulfillmentAllocation.findMany({ where: { quotationId } });
    expect(allocations).toHaveLength(2);
    for (const a of allocations) {
      expect(a.isManualOverride).toBe(true);
    }

    const trail = await auditTrailFor("Quotation", quotationId);
    const override = trail.find((e) => e.action === "OVERRIDE")!;
    const changes = override.fieldChanges as Record<string, unknown>;

    expect(override.reason).toContain("closer to the customer");
    // Both sides recorded: what the system suggested and what a human chose.
    expect(changes.recommended).toBeDefined();
    expect(changes.chosen).toBeDefined();
    expect(changes.recommendedShipments).toBe(1);
    expect(changes.chosenShipments).toBe(2);
  });

  it("requires a reason", async () => {
    const quotationId = await approvedOrder(5);
    const line = await prisma.quotationLine.findFirstOrThrow({ where: { quotationId } });

    await expect(
      overrideAllocation({
        quotationId,
        user: finance,
        picks: [{ lineId: line.id, warehouseId: mainId, quantity: 5 }],
        reason: "  ",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("still cannot allocate stock that is not there", async () => {
    const quotationId = await approvedOrder(10);
    const line = await prisma.quotationLine.findFirstOrThrow({ where: { quotationId } });

    // East Depot only holds 8.
    await expect(
      overrideAllocation({
        quotationId,
        user: finance,
        picks: [{ lineId: line.id, warehouseId: eastId, quantity: 10 }],
        reason: "Trying to take more than exists",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

/**
 * §B6: the "Consolidate Remaining Backorder" prompt appears automatically when
 * stock arrives, so the check is triggered by the receipt rather than polled.
 */
describe("backorder consolidation on stock receipt", () => {
  it("surfaces nothing while the shortfall remains", async () => {
    const quotationId = await approvedOrder(25);
    await allocateFulfillment({ quotationId, user: finance });

    expect(await findConsolidatableBackorders(mainId)).toEqual([]);
  });

  it("offers the backorder as soon as enough stock arrives", async () => {
    const quotationId = await approvedOrder(25);
    await allocateFulfillment({ quotationId, user: finance });

    const receipt = await receiveStock({
      warehouseId: mainId,
      productId: laptopId,
      quantity: 5,
    });

    expect(receipt.available).toBe(17);

    const mine = receipt.consolidatable.filter((c) => c.quotationId === quotationId);
    expect(mine).toHaveLength(1);
    expect(mine[0].quantity).toBe(5);
  });

  // Consolidating half a backorder turns one late shipment into two.
  it("does not offer partial coverage", async () => {
    const quotationId = await approvedOrder(25);
    await allocateFulfillment({ quotationId, user: finance });

    const receipt = await receiveStock({
      warehouseId: mainId,
      productId: laptopId,
      quantity: 3, // short of the 5 outstanding
    });

    expect(receipt.consolidatable).toEqual([]);
  });

  it("closes the backorder and reserves the newly received stock", async () => {
    const quotationId = await approvedOrder(25);
    await allocateFulfillment({ quotationId, user: finance });
    const { consolidatable } = await receiveStock({
      warehouseId: mainId,
      productId: laptopId,
      quantity: 5,
    });

    const mine = consolidatable.find((c) => c.quotationId === quotationId)!;
    await consolidateBackorder({
      backorderId: mine.backorderId,
      warehouseId: mainId,
      user: finance,
    });

    const backorder = await prisma.backorder.findFirstOrThrow({ where: { quotationId } });
    expect(backorder.status).toBe("CONSOLIDATED");

    const main = await prisma.warehouseStock.findFirstOrThrow({
      where: { warehouseId: mainId, productId: laptopId },
    });
    expect(main.reservedQuantity).toBe(17); // 12 originally + the 5 just consolidated
  });

  it("refuses a Sales Rep", async () => {
    const quotationId = await approvedOrder(25);
    await allocateFulfillment({ quotationId, user: finance });
    const { consolidatable } = await receiveStock({
      warehouseId: mainId,
      productId: laptopId,
      quantity: 5,
    });

    const mine = consolidatable.find((c) => c.quotationId === quotationId)!;
    await expect(
      consolidateBackorder({ backorderId: mine.backorderId, warehouseId: mainId, user: rep }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

/**
 * The point of building the pre-flight at all: until a plan exists the risk
 * engine has no delivery outlook and scores that contributor as zero.
 */
describe("the plan feeds the risk score", () => {
  it("turns delivery risk from none into a split once a plan exists", async () => {
    const quotationId = await approvedOrder(20);

    const before = await recomputeQuotation(quotationId);
    expect(before.riskFactors.find((f) => f.source === "DELIVERY_RISK")!.points).toBe(0);

    await planFulfillment(quotationId);
    const after = await recomputeQuotation(quotationId);

    // Two warehouses, no backorder.
    expect(after.riskFactors.find((f) => f.source === "DELIVERY_RISK")!.points).toBe(5);
  });

  it("scores a backorder higher than a split", async () => {
    const quotationId = await approvedOrder(25);
    await allocateFulfillment({ quotationId, user: finance });

    const result = await recomputeQuotation(quotationId);
    expect(result.riskFactors.find((f) => f.source === "DELIVERY_RISK")!.points).toBe(10);
  });
});

describe("an order cannot be allocated twice at once", () => {
  // The already-allocated guard has to sit inside the lock. Outside it, two
  // confirmations arriving together both read zero and both reserve stock.
  it("lets exactly one of two simultaneous allocations through", async () => {
    const quotationId = await approvedOrder(5);

    const results = await Promise.allSettled([
      allocateFulfillment({ quotationId, user: finance }),
      allocateFulfillment({ quotationId, user: finance }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

    const allocations = await prisma.fulfillmentAllocation.findMany({ where: { quotationId } });
    const total = allocations.reduce((acc, a) => acc + a.allocatedQuantity, 0);
    expect(total).toBe(5);

    const main = await prisma.warehouseStock.findFirstOrThrow({
      where: { warehouseId: mainId, productId: laptopId },
    });
    expect(main.reservedQuantity).toBe(5);
  });
});
