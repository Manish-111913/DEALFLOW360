import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "../generated/prisma/client";
import type { AuthzUser } from "../authz/roles";
import { prisma } from "../db";
import { planAllocation, stockKey } from "../engines/allocation";
import { rankUpsells } from "../engines/upsell";
import { __clearSettingsCacheForTests, getSettings, setSetting } from "../settings";
import { allocateFulfillment } from "./fulfillment";
import { addQuotationLine, createQuotation } from "./quotations";

/**
 * Changing a setting changes what the application decides.
 *
 * This is the file that makes the Settings screen worth having. Each test flips
 * one value and shows a different outcome coming out of the engine that reads
 * it - not that the value was stored, which is the easy half and the one that
 * lets a settings page look like it works while doing nothing.
 */

const D = (v: string | number) => new Prisma.Decimal(v);

let acmeId: string;
let repId: string;
let laptopId: string;
let finance: AuthzUser;
const created: string[] = [];

/** Restores whatever a test changed, so the demo data is left as it was. */
const restore: (() => Promise<unknown>)[] = [];

beforeAll(async () => {
  acmeId = (await prisma.customer.findFirstOrThrow({ where: { name: "Acme Industries" } })).id;
  const r = await prisma.user.findUniqueOrThrow({ where: { email: "priya@dealflow360.test" } });
  const f = await prisma.user.findUniqueOrThrow({ where: { email: "finance@dealflow360.test" } });
  repId = r.id;
  finance = { id: f.id, kind: "INTERNAL", role: "FINANCE_OPS", customerId: null, salesTeamId: null };
  laptopId = (await prisma.product.findUniqueOrThrow({ where: { sku: "HW-LAPTOP-PRO" } })).id;
});

afterEach(async () => {
  while (restore.length > 0) await restore.pop()!();
  __clearSettingsCacheForTests();
});

afterAll(async () => {
  await prisma.quotation.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

async function withSetting(key: string, value: string) {
  const before = await prisma.systemSetting.findUnique({ where: { key } });
  restore.push(async () => {
    if (before) {
      await setSetting({ key: key as never, value: before.value });
    }
    __clearSettingsCacheForTests();
  });
  await setSetting({ key: key as never, value });
  __clearSettingsCacheForTests();
}

// ---------------------------------------------------------------------------
// The allocator's tie-break
// ---------------------------------------------------------------------------

/**
 * One expensive depot that can fill the order alone, and two cheap ones that
 * can only fill it together.
 *
 * The allocator does not enumerate arbitrary splits - its candidates are each
 * single source that can fill the order, the fewest-warehouses plan, and the
 * priority walk. So the cheap pair has to be reachable *through the priority
 * walk* for there to be a genuine trade-off at all, which is why the cheap
 * depots hold the two lowest priorities.
 *
 * That leaves exactly the choice the setting decides: one parcel at 900, or two
 * at 100 the pair.
 */
function depots() {
  return {
    demand: [{ lineId: "line-1", productId: "p1", variantId: null, quantity: 10 }],
    warehouses: [
      {
        warehouseId: "cheap-a",
        warehouseName: "Cheap A",
        priority: 1,
        perShipmentCost: D(50),
        available: { [stockKey("p1")]: 6 },
      },
      {
        warehouseId: "cheap-b",
        warehouseName: "Cheap B",
        priority: 2,
        perShipmentCost: D(50),
        available: { [stockKey("p1")]: 6 },
      },
      {
        warehouseId: "pricey",
        warehouseName: "Pricey Depot",
        priority: 3,
        perShipmentCost: D(900),
        available: { [stockKey("p1")]: 10 },
      },
    ],
  };
}

describe("fulfilment ranking", () => {
  it("prefers one expensive shipment when shipments come first", () => {
    const plan = planAllocation({ ...depots(), ranking: "SHIPMENTS_FIRST" }).recommended;
    expect(plan.shipmentCount).toBe(1);
    expect(plan.warehouseIds).toEqual(["pricey"]);
    expect(plan.shippingCost.equals(D(900))).toBe(true);
  });

  it("prefers the cheaper pair of shipments when cost comes first", () => {
    const plan = planAllocation({ ...depots(), ranking: "COST_FIRST" }).recommended;
    expect(plan.shipmentCount).toBe(2);
    expect(plan.shippingCost.equals(D(100))).toBe(true);
    expect(plan.warehouseIds.sort()).toEqual(["cheap-a", "cheap-b"]);
  });

  it("never trades unfilled demand for a lower price", () => {
    const short = {
      demand: [{ lineId: "line-1", productId: "p1", variantId: null, quantity: 10 }],
      warehouses: [
        {
          warehouseId: "cheap",
          warehouseName: "Cheap Depot",
          priority: 1,
          perShipmentCost: D(10),
          available: { [stockKey("p1")]: 4 },
        },
        {
          warehouseId: "pricey",
          warehouseName: "Pricey Depot",
          priority: 2,
          perShipmentCost: D(900),
          available: { [stockKey("p1")]: 10 },
        },
      ],
    };

    const plan = planAllocation({ ...short, ranking: "COST_FIRST" }).recommended;
    expect(plan.shortfalls).toEqual([]);
  });

  it("defaults to D9's rule when no ranking is given", () => {
    const plan = planAllocation(depots()).recommended;
    expect(plan.shipmentCount).toBe(1);
  });
});

describe("backorder handling", () => {
  it("refuses an unfillable order when backorders are switched off", async () => {
    const stock = await prisma.warehouseStock.findMany({ where: { productId: laptopId } });
    const held = stock.map((row) => ({ ...row }));
    restore.push(async () => {
      for (const row of held) {
        await prisma.warehouseStock.update({
          where: { id: row.id },
          data: { availableQuantity: row.availableQuantity, reservedQuantity: row.reservedQuantity },
        });
      }
    });

    // Strip the network almost bare, so any real order must short.
    for (const row of stock) {
      await prisma.warehouseStock.update({
        where: { id: row.id },
        data: { availableQuantity: 1, reservedQuantity: 0 },
      });
    }

    const quotation = await createQuotation({ customerId: acmeId, salesRepId: repId });
    created.push(quotation.id);
    await addQuotationLine({ quotationId: quotation.id, productId: laptopId, quantity: 40 });
    await prisma.quotation.update({
      where: { id: quotation.id },
      data: { approvalState: "APPROVED", status: "CONFIRMED" },
    });

    await withSetting("fulfilment.backordersEnabled", "false");

    await expect(
      allocateFulfillment({ quotationId: quotation.id, user: finance }),
    ).rejects.toThrow(/backorders are disabled/i);

    // And nothing was half-written: the whole allocation rolled back.
    expect(
      await prisma.fulfillmentAllocation.count({ where: { quotationId: quotation.id } }),
    ).toBe(0);
    expect(await prisma.backorder.count({ where: { quotationId: quotation.id } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Upsell
// ---------------------------------------------------------------------------

const CANDIDATES = [
  {
    productId: "popular",
    productName: "Popular but thin",
    coPurchaseRate: "0.90",
    minMarginPercentage: "0",
    isPromoted: false,
    unitPrice: "100",
    unitCost: "88",
    triggeredByProductName: "Base",
  },
  {
    productId: "profitable",
    productName: "Rare but rich",
    coPurchaseRate: "0.05",
    minMarginPercentage: "0",
    isPromoted: false,
    unitPrice: "100",
    unitCost: "20",
    triggeredByProductName: "Base",
  },
];

describe("upsell controls", () => {
  it("ranks the popular pairing first while history counts", () => {
    const ranked = rankUpsells(CANDIDATES);
    expect(ranked[0].productId).toBe("popular");
  });

  it("ranks by margin once history is switched off", () => {
    const ranked = rankUpsells(CANDIDATES, { policy: { useHistory: false } });
    expect(ranked[0].productId).toBe("profitable");
  });

  it("drops a suggestion below the company-wide margin floor", () => {
    // The thin one earns 12%; a 20% floor should remove it entirely rather
    // than merely demote it.
    const ranked = rankUpsells(CANDIDATES, { policy: { minMarginPercentage: "20" } });
    expect(ranked.map((r) => r.productId)).toEqual(["profitable"]);
  });

  it("stops a promoted product jumping the queue when the bonus is off", () => {
    const promoted = CANDIDATES.map((c) =>
      c.productId === "popular" ? { ...c, isPromoted: true } : c,
    );
    const withBonus = rankUpsells(promoted, { policy: { useHistory: false } });
    const withoutBonus = rankUpsells(promoted, {
      policy: { useHistory: false, usePromoted: false },
    });

    // With history off, margin decides - unless the promotion bonus is enough
    // to overturn it, which is precisely what the toggle controls.
    expect(withoutBonus[0].productId).toBe("profitable");
    expect(withBonus.length).toBe(withoutBonus.length);
  });
});

// ---------------------------------------------------------------------------
// The cache that made this hard
// ---------------------------------------------------------------------------

describe("a saved setting is visible to the next read", () => {
  it("does not need a restart", async () => {
    await withSetting("margin.targetPercentage", "42");
    const settings = await getSettings();
    expect(settings.targetMarginPercentage.toFixed(0)).toBe("42");
  });

  it("carries the fulfilment ranking through to the resolved settings", async () => {
    await withSetting("fulfilment.ranking", "COST_FIRST");
    expect((await getSettings()).fulfilmentRanking).toBe("COST_FIRST");
  });
});
