import { Prisma } from "../generated/prisma/client";
import { type Explanation, step } from "./explain";
import type { DecimalValue } from "./margin";

/**
 * The warehouse allocation engine.
 *
 * ---------------------------------------------------------------------------
 * HOW THIS WORKS, IN SHORT
 * ---------------------------------------------------------------------------
 * 1. Build several candidate plans for the whole order (not line by line).
 * 2. Rank them: fewest shipments first, then cheapest, then warehouse priority.
 * 3. Return the winner, and keep the runner-up so a human can see the choice.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS NOT A SIMPLE PRIORITY WALK
 * ---------------------------------------------------------------------------
 * §A4 asks for shipping-cost weighting "used by the auto split logic to
 * minimize number of shipments". A greedy walk down a priority list does not
 * minimise shipments. Counter-example:
 *
 *     Need 10 units. Main (priority 1) has 6. East (priority 2) has 10.
 *     Priority walk : 6 from Main + 4 from East = 2 shipments
 *     This engine    : 10 from East             = 1 shipment, and cheaper
 *
 * ---------------------------------------------------------------------------
 * WHY IT PLANS THE ORDER, NOT EACH LINE (D9)
 * ---------------------------------------------------------------------------
 * A warehouse used by three lines is still one shipment. Optimising per line
 * cannot see that:
 *
 *     Line 1 needs P1, Line 2 needs P2. Main stocks P1 only; East stocks both.
 *     Per line : L1 -> Main, L2 -> East = 2 shipments (each line optimal!)
 *     Per order: both from East         = 1 shipment
 *
 * Pure: no database, no clock, no I/O. Stock arrives as a snapshot, so the same
 * engine serves the advisory pre-flight (D4, reserves nothing) and the
 * authoritative allocation after confirmation.
 */

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface DemandLine {
  lineId: string;
  productId: string;
  variantId?: string | null;
  label?: string;
  quantity: number;
}

export interface WarehouseSnapshot {
  warehouseId: string;
  warehouseName: string;
  /** Lower is preferred, all else equal. Admin-configured, never hardcoded. */
  priority: number;
  /** Cost of one shipment from here. */
  perShipmentCost: DecimalValue;
  /** Units on hand and unreserved, keyed by stockKey(). */
  available: Record<string, number>;
}

export interface AllocationInput {
  demand: DemandLine[];
  warehouses: WarehouseSnapshot[];
}

/** Stock is held per product *and* variant, so both form the key. */
export function stockKey(productId: string, variantId?: string | null): string {
  return variantId ? `${productId}::${variantId}` : productId;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export interface PlannedPick {
  lineId: string;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
}

export interface PlannedShortfall {
  lineId: string;
  label?: string;
  quantity: number;
}

export interface AllocationPlan {
  picks: PlannedPick[];
  shortfalls: PlannedShortfall[];
  /** Distinct warehouses used across the whole order (D9). */
  warehouseIds: string[];
  shipmentCount: number;
  shippingCost: Decimal;
  strategy: "SINGLE_SOURCE" | "FEWEST_WAREHOUSES" | "PRIORITY_ORDER";
  rationale: string;
}

export interface AllocationResult {
  recommended: AllocationPlan;
  /** The next-best distinct plan, so the screen can show the trade-off. */
  runnerUp: AllocationPlan | null;
  explain: Explanation;
}

// ---------------------------------------------------------------------------
// Plan construction
// ---------------------------------------------------------------------------

/** Remaining units per line, as a mutable working copy. */
function openDemand(demand: DemandLine[]): Map<string, number> {
  return new Map(demand.map((d) => [d.lineId, d.quantity]));
}

/** How many units of the open demand this warehouse could satisfy. */
function coverageOf(
  warehouse: WarehouseSnapshot,
  demand: DemandLine[],
  remaining: Map<string, number>,
  consumed: Map<string, number>,
): number {
  let total = 0;
  for (const line of demand) {
    const need = remaining.get(line.lineId) ?? 0;
    if (need === 0) continue;
    total += Math.min(need, freeAt(warehouse, line, consumed));
  }
  return total;
}

/**
 * Units of this line still available at this warehouse.
 *
 * The consumed tally is scoped to the warehouse: stock is held per warehouse,
 * so drawing units from Main must not reduce what East Depot can supply.
 */
function freeAt(
  warehouse: WarehouseSnapshot,
  line: DemandLine,
  consumed: Map<string, number>,
): number {
  const key = stockKey(line.productId, line.variantId);
  const scoped = `${warehouse.warehouseId}::${key}`;
  return Math.max(0, (warehouse.available[key] ?? 0) - (consumed.get(scoped) ?? 0));
}

/** Take everything this warehouse can give against the open demand. */
function drawFrom(
  warehouse: WarehouseSnapshot,
  demand: DemandLine[],
  remaining: Map<string, number>,
  consumed: Map<string, number>,
  picks: PlannedPick[],
): void {
  for (const line of demand) {
    const need = remaining.get(line.lineId) ?? 0;
    if (need === 0) continue;

    const take = Math.min(need, freeAt(warehouse, line, consumed));
    if (take === 0) continue;

    const scoped = `${warehouse.warehouseId}::${stockKey(line.productId, line.variantId)}`;

    picks.push({
      lineId: line.lineId,
      warehouseId: warehouse.warehouseId,
      warehouseName: warehouse.warehouseName,
      quantity: take,
    });
    remaining.set(line.lineId, need - take);
    consumed.set(scoped, (consumed.get(scoped) ?? 0) + take);
  }
}

function finishPlan(
  input: AllocationInput,
  picks: PlannedPick[],
  remaining: Map<string, number>,
  strategy: AllocationPlan["strategy"],
  rationale: string,
): AllocationPlan {
  const warehouseIds = [...new Set(picks.map((p) => p.warehouseId))];
  const costByWarehouse = new Map(
    input.warehouses.map((w) => [w.warehouseId, new Decimal(w.perShipmentCost)]),
  );

  // D9: one shipment per warehouse used, counted across the whole order — not
  // summed per line, which would multiply the cost by the number of lines.
  const shippingCost = warehouseIds.reduce(
    (acc, id) => acc.plus(costByWarehouse.get(id) ?? new Decimal(0)),
    new Decimal(0),
  );

  const shortfalls: PlannedShortfall[] = input.demand
    .map((line) => ({
      lineId: line.lineId,
      label: line.label,
      quantity: remaining.get(line.lineId) ?? 0,
    }))
    .filter((s) => s.quantity > 0);

  return {
    picks,
    shortfalls,
    warehouseIds,
    shipmentCount: warehouseIds.length,
    shippingCost,
    strategy,
    rationale,
  };
}

/** One warehouse covers the entire order. Always one shipment. */
function singleSourcePlans(input: AllocationInput): AllocationPlan[] {
  const plans: AllocationPlan[] = [];

  for (const warehouse of input.warehouses) {
    const remaining = openDemand(input.demand);
    const consumed = new Map<string, number>();
    const picks: PlannedPick[] = [];

    drawFrom(warehouse, input.demand, remaining, consumed, picks);

    const coversEverything = [...remaining.values()].every((q) => q === 0);
    if (!coversEverything) continue;

    plans.push(
      finishPlan(
        input,
        picks,
        remaining,
        "SINGLE_SOURCE",
        `${warehouse.warehouseName} covers the whole order in one shipment`,
      ),
    );
  }

  return plans;
}

/**
 * Set-cover heuristic: repeatedly take the warehouse that satisfies the most
 * remaining units. This is what sees the cross-line saving a per-line
 * allocator cannot.
 */
function fewestWarehousesPlan(input: AllocationInput): AllocationPlan {
  const remaining = openDemand(input.demand);
  const consumed = new Map<string, number>();
  const picks: PlannedPick[] = [];
  const untried = [...input.warehouses];

  while (untried.length > 0 && [...remaining.values()].some((q) => q > 0)) {
    let best: WarehouseSnapshot | null = null;
    let bestCoverage = 0;

    for (const warehouse of untried) {
      const coverage = coverageOf(warehouse, input.demand, remaining, consumed);
      if (coverage === 0) continue;

      const better =
        coverage > bestCoverage ||
        (coverage === bestCoverage &&
          best !== null &&
          isCheaperOrHigherPriority(warehouse, best));

      if (best === null || better) {
        best = warehouse;
        bestCoverage = coverage;
      }
    }

    if (best === null) break;
    drawFrom(best, input.demand, remaining, consumed, picks);
    untried.splice(untried.indexOf(best), 1);
  }

  return finishPlan(
    input,
    picks,
    remaining,
    "FEWEST_WAREHOUSES",
    "Chosen to use as few warehouses as possible",
  );
}

function isCheaperOrHigherPriority(a: WarehouseSnapshot, b: WarehouseSnapshot): boolean {
  const costDelta = new Decimal(a.perShipmentCost).comparedTo(new Decimal(b.perShipmentCost));
  if (costDelta !== 0) return costDelta < 0;
  return a.priority < b.priority;
}

/** The classic priority walk, kept as a candidate and as the runner-up. */
function priorityOrderPlan(input: AllocationInput): AllocationPlan {
  const remaining = openDemand(input.demand);
  const consumed = new Map<string, number>();
  const picks: PlannedPick[] = [];

  const byPriority = [...input.warehouses].sort((a, b) => a.priority - b.priority);
  for (const warehouse of byPriority) {
    drawFrom(warehouse, input.demand, remaining, consumed, picks);
  }

  return finishPlan(
    input,
    picks,
    remaining,
    "PRIORITY_ORDER",
    "Filled in configured warehouse priority order",
  );
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/** Fewest unfulfilled units, then fewest shipments, then cheapest. */
function comparePlans(a: AllocationPlan, b: AllocationPlan): number {
  const unmet = (p: AllocationPlan) => p.shortfalls.reduce((acc, s) => acc + s.quantity, 0);

  const byUnmet = unmet(a) - unmet(b);
  if (byUnmet !== 0) return byUnmet;

  const byShipments = a.shipmentCount - b.shipmentCount;
  if (byShipments !== 0) return byShipments;

  return a.shippingCost.comparedTo(b.shippingCost);
}

function samePlan(a: AllocationPlan, b: AllocationPlan): boolean {
  return (
    a.shipmentCount === b.shipmentCount &&
    a.shippingCost.equals(b.shippingCost) &&
    a.warehouseIds.join("|") === b.warehouseIds.join("|")
  );
}

export function planAllocation(input: AllocationInput): AllocationResult {
  const candidates = [
    ...singleSourcePlans(input),
    fewestWarehousesPlan(input),
    priorityOrderPlan(input),
  ].sort(comparePlans);

  const recommended = candidates[0];
  const runnerUp = candidates.find((p) => !samePlan(p, recommended)) ?? null;

  const totalShort = recommended.shortfalls.reduce((acc, s) => acc + s.quantity, 0);

  return {
    recommended,
    runnerUp,
    explain: {
      label: "Fulfilment plan",
      value: `${recommended.shipmentCount} shipment${recommended.shipmentCount === 1 ? "" : "s"}, ${recommended.shippingCost.toFixed(2)}`,
      inputs: {
        lines: String(input.demand.length),
        warehouses: input.warehouses.map((w) => w.warehouseName).join(", ") || "none",
        strategy: recommended.strategy,
      },
      steps: [
        step("Plans considered", candidates.map((c) => c.strategy).join(", "), String(candidates.length)),
        step(
          "Chosen",
          recommended.rationale,
          `${recommended.shipmentCount} shipments at ${recommended.shippingCost.toFixed(2)}`,
        ),
        ...(runnerUp
          ? [
              step(
                "Runner-up",
                runnerUp.rationale,
                `${runnerUp.shipmentCount} shipments at ${runnerUp.shippingCost.toFixed(2)}`,
              ),
            ]
          : []),
        step(
          "Unfulfilled",
          totalShort > 0 ? "becomes a backorder rather than vanishing" : "none",
          String(totalShort),
        ),
      ],
      sources: ["03_BUSINESS_RULES.md - Warehouse Fulfillment Engine", "D8", "D9"],
    },
  };
}
