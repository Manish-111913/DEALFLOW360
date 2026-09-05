import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, type AuthzUser } from "../authz/roles";
import { advanceClock, currentBusinessTime, resetClock } from "../clock";
import { prisma } from "../db";
import {
  getConfigurationOverview,
  listCategories,
  listDiscountPolicy,
  listPriceLists,
  listReplenishmentNeeds,
  listSettings,
  listUpsellRules,
  listWarehouses,
} from "./configuration";
import { scoreDealHealth } from "./deal-health";
import {
  allocateFulfillment,
  dispatchShipment,
  findSlippedShipments,
  getFulfillmentView,
  planFulfillment,
  recordDelivery,
} from "./fulfillment";
import { addQuotationLine, createQuotation } from "./quotations";

const DAY_MS = 86_400_000;

let acmeId: string;
let repId: string;
let laptopId: string;
let mainId: string;
let eastId: string;
let finance: AuthzUser;
let rep: AuthzUser;
let admin: AuthzUser;
const created: string[] = [];

async function approvedOrder(quantity: number) {
  const q = await createQuotation({ customerId: acmeId, salesRepId: repId });
  created.push(q.id);
  await addQuotationLine({ quotationId: q.id, productId: laptopId, quantity, discountPercentage: "0" });
  await prisma.quotation.update({
    where: { id: q.id },
    data: { approvalState: "APPROVED", status: "CONFIRMED" },
  });
  return q.id;
}

async function resetStock() {
  await prisma.warehouseStock.updateMany({
    where: { warehouseId: mainId, productId: laptopId },
    data: { availableQuantity: 12, reservedQuantity: 0 },
  });
  await prisma.warehouseStock.updateMany({
    where: { warehouseId: eastId, productId: laptopId },
    data: { availableQuantity: 8, reservedQuantity: 0 },
  });
}

beforeAll(async () => {
  acmeId = (await prisma.customer.findUniqueOrThrow({ where: { name: "Acme Industries" } })).id;
  const r = await prisma.user.findUniqueOrThrow({ where: { email: "priya@dealflow360.test" } });
  const f = await prisma.user.findUniqueOrThrow({ where: { email: "finance@dealflow360.test" } });
  const a = await prisma.user.findUniqueOrThrow({ where: { email: "admin@dealflow360.test" } });
  repId = r.id;
  rep = { id: r.id, kind: "INTERNAL", role: "SALES_REP", customerId: null, salesTeamId: r.salesTeamId };
  finance = { id: f.id, kind: "INTERNAL", role: "FINANCE_OPS", customerId: null, salesTeamId: null };
  admin = { id: a.id, kind: "INTERNAL", role: "ADMIN", customerId: null, salesTeamId: null };

  laptopId = (await prisma.product.findUniqueOrThrow({ where: { sku: "HW-LAPTOP-PRO" } })).id;
  mainId = (await prisma.warehouse.findUniqueOrThrow({ where: { code: "MAIN" } })).id;
  eastId = (await prisma.warehouse.findUniqueOrThrow({ where: { code: "EAST" } })).id;
});

afterEach(async () => {
  await resetClock("test");
});

afterAll(async () => {
  await resetClock("test");
  await prisma.quotation.deleteMany({ where: { id: { in: created } } });
  await resetStock();
  await prisma.$disconnect();
});

/**
 * The split was being written to FulfillmentPlanLine and never read back, so it
 * existed in the database but could not be shown to anyone.
 */
describe("the fulfilment screen can actually read the split", () => {
  it("returns which warehouse supplies which line", async () => {
    await resetStock();
    const quotationId = await approvedOrder(20);
    await planFulfillment(quotationId);

    const view = await getFulfillmentView(admin, quotationId);

    expect(view.recommended).not.toBeNull();
    expect(view.recommended!.shipmentCount).toBe(2);
    expect(view.recommended!.shippingCost).toBe("370.00");
    expect(view.recommended!.lines).toHaveLength(2);

    const byWarehouse = Object.fromEntries(
      view.recommended!.lines.map((l) => [l.warehouseName, l.quantity]),
    );
    expect(byWarehouse["Main Warehouse"]).toBe(12);
    expect(byWarehouse["East Depot"]).toBe(8);
    expect(view.recommended!.lines[0].productName).toBe("Laptop Pro");
  });

  it("says how fresh the stock reading behind the plan is", async () => {
    await resetStock();
    const quotationId = await approvedOrder(5);
    await planFulfillment(quotationId);

    const view = await getFulfillmentView(admin, quotationId);
    expect(view.recommended!.stockSnapshotAt).toBeInstanceOf(Date);
  });

  it("surfaces allocations and backorders together", async () => {
    await resetStock();
    const quotationId = await approvedOrder(25);
    await allocateFulfillment({ quotationId, user: finance });

    const view = await getFulfillmentView(admin, quotationId);

    expect(view.allocations).toHaveLength(2);
    expect(view.allocations.every((a) => a.productName === "Laptop Pro")).toBe(true);
    expect(view.backorders).toHaveLength(1);
    expect(view.backorders[0].quantity).toBe(5);
  });
});

/** §B9 asks for delivery slippage, which needs a promise and an outcome. */
describe("shipments and delivery slippage", () => {
  it("dispatches what is reserved at a warehouse and consumes the stock", async () => {
    await resetStock();
    const quotationId = await approvedOrder(5);
    await allocateFulfillment({ quotationId, user: finance });

    const result = await dispatchShipment({
      quotationId,
      warehouseId: mainId,
      user: finance,
      estimatedDeliveryDate: new Date(currentBusinessTime().getTime() + 2 * DAY_MS),
    });

    expect(result.shipmentNumber).toMatch(/^SHP-\d{4}-\d{4}$/);

    const main = await prisma.warehouseStock.findFirstOrThrow({
      where: { warehouseId: mainId, productId: laptopId },
    });
    // Shipped stock is no longer on hand, and no longer reserved either.
    expect(main.availableQuantity).toBe(7);
    expect(main.reservedQuantity).toBe(0);
  });

  it("refuses a Sales Rep", async () => {
    await resetStock();
    const quotationId = await approvedOrder(5);
    await allocateFulfillment({ quotationId, user: finance });

    await expect(
      dispatchShipment({ quotationId, warehouseId: mainId, user: rep }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("counts an overdue undelivered shipment as slipped", async () => {
    await resetStock();
    const quotationId = await approvedOrder(5);
    await allocateFulfillment({ quotationId, user: finance });
    await dispatchShipment({
      quotationId,
      warehouseId: mainId,
      user: finance,
      estimatedDeliveryDate: new Date(currentBusinessTime().getTime() + DAY_MS),
    });

    // Nothing has arrived and the promised date has passed.
    await advanceClock({ days: 3 }, "test");

    const slipped = (await findSlippedShipments()).filter((s) => s.quotationId === quotationId);
    expect(slipped).toHaveLength(1);
    expect(slipped[0].daysLate).toBe(2);
    expect(slipped[0].actualDeliveryDate).toBeNull();
  });

  it("counts a late arrival as slipped, and an on-time one as not", async () => {
    await resetStock();
    const lateId = await approvedOrder(3);
    await allocateFulfillment({ quotationId: lateId, user: finance });
    const late = await dispatchShipment({
      quotationId: lateId,
      warehouseId: mainId,
      user: finance,
      estimatedDeliveryDate: new Date(currentBusinessTime().getTime() + DAY_MS),
    });

    await advanceClock({ days: 4 }, "test");
    const lateResult = await recordDelivery({ shipmentId: late.shipmentId, user: finance });
    expect(lateResult.slipped).toBe(true);
    expect(lateResult.daysLate).toBe(3);

    await resetClock("test");
    await resetStock();
    const onTimeId = await approvedOrder(3);
    await allocateFulfillment({ quotationId: onTimeId, user: finance });
    const onTime = await dispatchShipment({
      quotationId: onTimeId,
      warehouseId: mainId,
      user: finance,
      estimatedDeliveryDate: new Date(currentBusinessTime().getTime() + 5 * DAY_MS),
    });

    const onTimeResult = await recordDelivery({ shipmentId: onTime.shipmentId, user: finance });
    expect(onTimeResult.slipped).toBe(false);
  });

  it("shows the slippage flag on the fulfilment view", async () => {
    await resetStock();
    const quotationId = await approvedOrder(4);
    await allocateFulfillment({ quotationId, user: finance });
    await dispatchShipment({
      quotationId,
      warehouseId: mainId,
      user: finance,
      estimatedDeliveryDate: new Date(currentBusinessTime().getTime() + DAY_MS),
    });
    await advanceClock({ days: 2 }, "test");

    const view = await getFulfillmentView(admin, quotationId);
    expect(view.shipments).toHaveLength(1);
    expect(view.shipments[0].slipped).toBe(true);
  });

  // The alert type existed but could never fire, because nothing created a
  // shipment for it to measure against.
  it("raises a delivery-slippage alert on the health dashboard", async () => {
    await resetStock();
    const quotationId = await approvedOrder(4);
    await allocateFulfillment({ quotationId, user: finance });
    await dispatchShipment({
      quotationId,
      warehouseId: mainId,
      user: finance,
      estimatedDeliveryDate: new Date(currentBusinessTime().getTime() + DAY_MS),
    });
    await advanceClock({ days: 3 }, "test");

    // The health snapshot needs a live quotation to score.
    await prisma.quotation.update({ where: { id: quotationId }, data: { status: "SENT" } });
    await scoreDealHealth(quotationId);

    const alerts = await prisma.dealAlert.findMany({
      where: { quotationId, type: "DELIVERY_SLIPPAGE" },
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).toContain("past its promised date");
  });
});

/**
 * §4A - the Admin configuration area. The engines already read this data;
 * nothing could list it, so the screens had no backend to call.
 */
describe("the configuration surface", () => {
  it("lists the catalogue building blocks", async () => {
    const categories = await listCategories();
    expect(categories.map((c) => c.name).sort()).toEqual([
      "Hardware",
      "Services",
      "Subscriptions",
    ]);
    expect(categories.every((c) => typeof c._count.products === "number")).toBe(true);
  });

  it("lists tier price lists with their items", async () => {
    const priceLists = await listPriceLists();
    const gold = priceLists.find((p) => p.tier === "GOLD");

    expect(gold).toBeDefined();
    expect(gold!.items.length).toBeGreaterThan(0);
    expect(gold!.items[0].product.sku).toBe("HW-LAPTOP-PRO");
  });

  it("lists both levels of the discount policy", async () => {
    const policy = await listDiscountPolicy();

    expect(policy.tierDefaults).toHaveLength(3);
    expect(policy.categoryOverrides.length).toBeGreaterThan(0);
    const goldServices = policy.categoryOverrides.find(
      (p) => p.tier === "GOLD" && p.category.name === "Services",
    );
    expect(goldServices!.maxDiscount.toFixed(2)).toBe("10.00");
  });

  it("lists warehouses with free stock and replenishment state", async () => {
    await resetStock();
    const warehouses = await listWarehouses();
    const main = warehouses.find((w) => w.code === "MAIN")!;
    const laptop = main.stock.find((row) => row.sku === "HW-LAPTOP-PRO")!;

    expect(main.priority).toBe(1);
    expect(main.shippingCost).toBe("150.00");
    expect(laptop.free).toBe(12);
    expect(laptop.reorderLevel).toBe(5);
  });

  it("flags stock at or below its reorder point", async () => {
    await prisma.warehouseStock.updateMany({
      where: { warehouseId: mainId, productId: laptopId },
      data: { availableQuantity: 3, reservedQuantity: 0 },
    });

    try {
      const needs = await listReplenishmentNeeds();
      const mine = needs.find((n) => n.warehouseId === mainId && n.productId === laptopId);
      expect(mine).toBeDefined();
      expect(mine!.suggestedOrderQuantity).toBe(20);
    } finally {
      await resetStock();
    }
  });

  it("shows the derived upsell rate and which one the engine uses", async () => {
    const rules = await listUpsellRules();
    const laptopToWarranty = rules.find(
      (r) => r.baseProduct.sku === "HW-LAPTOP-PRO" && r.suggestedProduct.sku === "HW-WARRANTY-EXT",
    )!;

    expect(laptopToWarranty.derivedRate).toBe("0.7200");
    expect(laptopToWarranty.effectiveRate).toBe("0.7200");
    expect(laptopToWarranty.isPromoted).toBe(true);
  });

  it("reports every setting and whether it is still on its default", async () => {
    const settings = await listSettings();

    expect(settings.length).toBeGreaterThanOrEqual(10);
    const currency = settings.find((s) => s.key === "currency.code")!;
    expect(currency.value).toBe("INR");
    expect(currency.description).toBeTruthy();

    const periods = settings.find((s) => s.key === "billing.periodsAhead")!;
    expect(periods.value).toBe("12");
  });

  it("returns the whole configuration area in one call", async () => {
    const overview = await getConfigurationOverview(admin);

    expect(overview.catalogue.categories.length).toBe(3);
    expect(overview.governance.tierDefaults.length).toBe(3);
    expect(overview.governance.approvalChains.length).toBeGreaterThan(0);
    expect(overview.operations.warehouses.length).toBe(2);
    expect(overview.operations.plans.length).toBeGreaterThan(0);
    expect(overview.teams.length).toBeGreaterThan(0);
    expect(overview.settings.length).toBeGreaterThanOrEqual(10);
  });

  // D16 - a manager owns discount policy, Admin owns the catalogue.
  it("tells a screen what the caller may change", async () => {
    const asAdmin = await getConfigurationOverview(admin);
    expect(asAdmin.permissions.product).toBe(true);
    expect(asAdmin.permissions.discountTier).toBe(true);

    const m = await prisma.user.findUniqueOrThrow({ where: { email: "manager@dealflow360.test" } });
    const manager: AuthzUser = {
      id: m.id,
      kind: "INTERNAL",
      role: "SALES_MANAGER",
      customerId: null,
      salesTeamId: m.salesTeamId,
    };
    const asManager = await getConfigurationOverview(manager);

    expect(asManager.permissions.discountTier).toBe(true);
    expect(asManager.permissions.approvalChain).toBe(true);
    expect(asManager.permissions.product).toBe(false);
    expect(asManager.permissions.warehouse).toBe(false);
  });

  it("is refused to a Sales Rep", async () => {
    await expect(getConfigurationOverview(rep)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
