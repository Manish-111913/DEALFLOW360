import { describe, expect, it } from "vitest";
import { Prisma } from "../generated/prisma/client";
import {
  planAllocation,
  stockKey,
  type AllocationInput,
  type WarehouseSnapshot,
} from "./allocation";

const D = (v: string | number) => new Prisma.Decimal(v);

const LAPTOP = "p-laptop";
const MOUSE = "p-mouse";

/** The seeded pair: Main is nearer and cheaper, East Depot is the fallback. */
function main(available: Record<string, number>): WarehouseSnapshot {
  return {
    warehouseId: "w-main",
    warehouseName: "Main",
    priority: 1,
    perShipmentCost: "150.00",
    available,
  };
}

function east(available: Record<string, number>): WarehouseSnapshot {
  return {
    warehouseId: "w-east",
    warehouseName: "East Depot",
    priority: 2,
    perShipmentCost: "220.00",
    available,
  };
}

function order(quantity: number, warehouses: WarehouseSnapshot[]): AllocationInput {
  return {
    demand: [{ lineId: "l1", productId: LAPTOP, label: "Laptop Pro", quantity }],
    warehouses,
  };
}

/** Units taken from a named warehouse, across the whole plan. */
function takenFrom(picks: { warehouseId: string; quantity: number }[], id: string): number {
  return picks.filter((p) => p.warehouseId === id).reduce((acc, p) => acc + p.quantity, 0);
}

describe("the frozen scenario: 20 units against 12 and 8", () => {
  const input = order(20, [main({ [LAPTOP]: 12 }), east({ [LAPTOP]: 8 })]);

  it("allocates 12 from Main and 8 from East Depot", () => {
    const { recommended } = planAllocation(input);

    expect(takenFrom(recommended.picks, "w-main")).toBe(12);
    expect(takenFrom(recommended.picks, "w-east")).toBe(8);
  });

  it("is two shipments costing 370 in total", () => {
    const { recommended } = planAllocation(input);

    expect(recommended.shipmentCount).toBe(2);
    expect(recommended.shippingCost.equals(D(370))).toBe(true);
  });

  it("leaves no backorder", () => {
    expect(planAllocation(input).recommended.shortfalls).toEqual([]);
  });

  // Neither warehouse alone covers 20, so shipment-minimising and priority-walk
  // agree here. That is why this scenario does not distinguish them.
  it("has no meaningful alternative to offer", () => {
    expect(planAllocation(input).runnerUp).toBeNull();
  });
});

describe("the frozen shortage scenario: 25 units against the same stock", () => {
  const input = order(25, [main({ [LAPTOP]: 12 }), east({ [LAPTOP]: 8 })]);

  it("still allocates 12 and 8", () => {
    const { recommended } = planAllocation(input);

    expect(takenFrom(recommended.picks, "w-main")).toBe(12);
    expect(takenFrom(recommended.picks, "w-east")).toBe(8);
  });

  // A request with insufficient stock is a valid outcome, not a failure.
  it("flags the remaining 5 units as a shortfall rather than losing them", () => {
    const { recommended } = planAllocation(input);

    expect(recommended.shortfalls).toEqual([
      { lineId: "l1", label: "Laptop Pro", quantity: 5 },
    ]);
  });

  it("returns a fully unfulfilled plan when there is no stock at all", () => {
    const { recommended } = planAllocation(order(10, [main({}), east({})]));

    expect(recommended.picks).toEqual([]);
    expect(recommended.shortfalls[0].quantity).toBe(10);
    expect(recommended.shipmentCount).toBe(0);
  });
});

/**
 * D8 - where a priority walk gets it wrong.
 *
 * §A4 asks the split logic to minimise the number of shipments. Filling in
 * priority order does not do that, and it costs more here as well.
 */
describe("shipment minimisation beats priority order", () => {
  const input = order(10, [main({ [LAPTOP]: 6 }), east({ [LAPTOP]: 10 })]);

  it("ships once from East rather than splitting across both", () => {
    const { recommended } = planAllocation(input);

    expect(recommended.shipmentCount).toBe(1);
    expect(takenFrom(recommended.picks, "w-east")).toBe(10);
    expect(takenFrom(recommended.picks, "w-main")).toBe(0);
  });

  it("is cheaper than the priority walk, not merely fewer shipments", () => {
    const { recommended } = planAllocation(input);

    expect(recommended.shippingCost.equals(D(220))).toBe(true);
  });

  // The trade-off the fulfilment screen exists to show.
  it("keeps the priority walk as the runner-up so a human can compare", () => {
    const { runnerUp } = planAllocation(input);

    expect(runnerUp).not.toBeNull();
    expect(runnerUp!.shipmentCount).toBe(2);
    expect(runnerUp!.shippingCost.equals(D(370))).toBe(true);
    expect(runnerUp!.strategy).toBe("PRIORITY_ORDER");
  });
});

/**
 * D9 - the order is planned as a whole.
 *
 * Each line below is individually optimal in the two-shipment plan, which is
 * precisely why a per-line allocator cannot find the one-shipment answer.
 */
describe("planning across lines, not line by line", () => {
  const input: AllocationInput = {
    demand: [
      { lineId: "l1", productId: LAPTOP, label: "Laptop Pro", quantity: 10 },
      { lineId: "l2", productId: MOUSE, label: "Mouse", quantity: 10 },
    ],
    warehouses: [
      main({ [LAPTOP]: 10 }), // stocks laptops only
      east({ [LAPTOP]: 10, [MOUSE]: 10 }), // stocks both
    ],
  };

  it("ships both lines from the one warehouse that stocks both", () => {
    const { recommended } = planAllocation(input);

    expect(recommended.shipmentCount).toBe(1);
    expect(recommended.warehouseIds).toEqual(["w-east"]);
    expect(recommended.shippingCost.equals(D(220))).toBe(true);
  });
});

describe("D9 - shipment cost is an order-level figure", () => {
  it("charges one shipment per warehouse however many lines use it", () => {
    const input: AllocationInput = {
      demand: [
        { lineId: "l1", productId: LAPTOP, quantity: 12 },
        { lineId: "l2", productId: MOUSE, quantity: 12 },
      ],
      warehouses: [
        main({ [LAPTOP]: 8, [MOUSE]: 8 }),
        east({ [LAPTOP]: 8, [MOUSE]: 8 }),
      ],
    };

    const { recommended } = planAllocation(input);

    // Both lines draw on both warehouses, but that is still two shipments.
    // Summing a per-line cost would give 740, which is the bug D9 prevents.
    expect(recommended.shipmentCount).toBe(2);
    expect(recommended.shippingCost.equals(D(370))).toBe(true);
  });
});

describe("variants are stocked separately from their base product", () => {
  it("does not treat one variant as stock for another", () => {
    const input: AllocationInput = {
      demand: [{ lineId: "l1", productId: LAPTOP, variantId: "v-32gb", quantity: 5 }],
      warehouses: [
        main({ [stockKey(LAPTOP, "v-16gb")]: 50 }), // plenty, but the wrong variant
        east({ [stockKey(LAPTOP, "v-32gb")]: 5 }),
      ],
    };

    const { recommended } = planAllocation(input);

    expect(takenFrom(recommended.picks, "w-east")).toBe(5);
    expect(takenFrom(recommended.picks, "w-main")).toBe(0);
  });
});

describe("D22 - the plan explains itself", () => {
  it("names the strategies considered and the runner-up", () => {
    const { explain } = planAllocation(
      order(10, [main({ [LAPTOP]: 6 }), east({ [LAPTOP]: 10 })]),
    );

    expect(explain.value).toBe("1 shipment, 220.00");
    const labels = explain.steps.map((s) => s.label);
    expect(labels).toContain("Plans considered");
    expect(labels).toContain("Chosen");
    expect(labels).toContain("Runner-up");
    expect(explain.sources).toContain("D8");
  });

  it("says plainly when units become a backorder", () => {
    const { explain } = planAllocation(
      order(25, [main({ [LAPTOP]: 12 }), east({ [LAPTOP]: 8 })]),
    );
    const unfulfilled = explain.steps.find((s) => s.label === "Unfulfilled")!;

    expect(unfulfilled.value).toBe("5");
    expect(unfulfilled.formula).toContain("backorder");
  });
});
