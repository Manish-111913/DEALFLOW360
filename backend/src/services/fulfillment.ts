import { Prisma } from "../generated/prisma/client";
import { appendAudit } from "../audit";
import { assertCan, type AuthzUser } from "../authz/roles";
import { currentBusinessTime } from "../clock";
import { prisma } from "../db";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { ADVISORY_LOCK } from "../locks";
import {
  planAllocation,
  stockKey,
  type AllocationPlan,
  type AllocationResult,
  type DemandLine,
  type WarehouseSnapshot,
} from "../engines/allocation";

/**
 * Fulfilment: planning, allocation, override and backorder consolidation.
 *
 * ---------------------------------------------------------------------------
 * THE TWO HALVES, AND WHY THEY ARE SEPARATE (D4)
 * ---------------------------------------------------------------------------
 *   planFulfillment()      advisory. Reserves nothing. Safe to run repeatedly
 *                          while a rep edits the quote. Feeds the risk score.
 *
 *   allocateFulfillment()  authoritative. Runs after the order is confirmed,
 *                          against freshly re-read stock, and reserves it.
 *
 * Keeping them apart is what breaks the circular dependency: risk needs a
 * delivery outlook, a delivery outlook needs stock, and reserving stock before
 * anyone has approved the deal would hold inventory hostage to a draft.
 *
 * The plan can go stale between the two - stock moves. D15 records that as a
 * variance rather than re-triggering approval, because re-approving on a
 * background stock change makes the workflow unpredictable.
 */

const Decimal = Prisma.Decimal;

// ---------------------------------------------------------------------------
// Reading the stock picture
// ---------------------------------------------------------------------------

/** What the engine needs: demand from the quotation, supply from the warehouses. */
async function readDemandAndSupply(quotationId: string): Promise<{
  demand: DemandLine[];
  warehouses: WarehouseSnapshot[];
  snapshotAt: Date;
}> {
  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    include: {
      lines: {
        orderBy: { sequence: "asc" },
        include: { product: { select: { name: true, type: true } } },
      },
    },
  });
  if (!quotation) throw new NotFoundError(`Quotation ${quotationId} does not exist`);

  // Subscriptions are billed, not shipped, so they carry no stock demand.
  const demand: DemandLine[] = quotation.lines
    .filter((line) => line.product.type !== "SUBSCRIPTION")
    .map((line) => ({
      lineId: line.id,
      productId: line.productId,
      variantId: line.variantId,
      label: line.product.name,
      quantity: line.quantity,
    }));

  const warehouses = await prisma.warehouse.findMany({
    where: { isActive: true },
    include: { stock: true },
    orderBy: { priority: "asc" },
  });

  const snapshot: WarehouseSnapshot[] = warehouses.map((w) => {
    const available: Record<string, number> = {};
    for (const row of w.stock) {
      // Reserved units belong to another order already.
      available[stockKey(row.productId, row.variantId)] = Math.max(
        0,
        row.availableQuantity - row.reservedQuantity,
      );
    }
    return {
      warehouseId: w.id,
      warehouseName: w.name,
      priority: w.priority,
      perShipmentCost: w.shippingCost,
      available,
    };
  });

  return { demand, warehouses: snapshot, snapshotAt: currentBusinessTime() };
}

// ---------------------------------------------------------------------------
// 1. Advisory planning (D4) - reserves nothing
// ---------------------------------------------------------------------------

export interface PlanResult extends AllocationResult {
  planId: string;
  runnerUpPlanId: string | null;
}

/**
 * Produce (or refresh) the advisory plan for a quotation.
 *
 * Writes the recommendation and, when the allocator found a genuinely different
 * second option, the runner-up alongside it as an ALTERNATIVE - which is what
 * lets the fulfilment screen show a trade-off rather than a single
 * take-it-or-leave-it answer (D8).
 */
export async function planFulfillment(quotationId: string): Promise<PlanResult> {
  const { demand, warehouses, snapshotAt } = await readDemandAndSupply(quotationId);
  const result = planAllocation({ demand, warehouses });

  const planId = await prisma.$transaction(async (tx) => {
    // Superseded rather than deleted, so a rep can see the plan they were shown
    // earlier if a question comes up.
    await tx.fulfillmentPlan.updateMany({
      where: { quotationId, status: { in: ["RECOMMENDED", "ALTERNATIVE"] } },
      data: { status: "SUPERSEDED" },
    });

    const created = await tx.fulfillmentPlan.create({
      data: {
        quotationId,
        status: "RECOMMENDED",
        estimatedShipmentCount: result.recommended.shipmentCount,
        estimatedShippingCost: result.recommended.shippingCost,
        rationale: result.recommended.rationale,
        stockSnapshotAt: snapshotAt,
        createdAt: snapshotAt,
        lines: {
          create: result.recommended.picks.map((p) => ({
            quotationLineId: p.lineId,
            warehouseId: p.warehouseId,
            quantity: p.quantity,
          })),
        },
      },
    });

    return created.id;
  });

  let runnerUpPlanId: string | null = null;
  if (result.runnerUp) {
    const alternative = await prisma.fulfillmentPlan.create({
      data: {
        quotationId,
        status: "ALTERNATIVE",
        isRunnerUp: true,
        estimatedShipmentCount: result.runnerUp.shipmentCount,
        estimatedShippingCost: result.runnerUp.shippingCost,
        rationale: result.runnerUp.rationale,
        stockSnapshotAt: snapshotAt,
        createdAt: snapshotAt,
        lines: {
          create: result.runnerUp.picks.map((p) => ({
            quotationLineId: p.lineId,
            warehouseId: p.warehouseId,
            quantity: p.quantity,
          })),
        },
      },
    });
    runnerUpPlanId = alternative.id;
  }

  return { ...result, planId, runnerUpPlanId };
}

/** True when this quotation already has a plan worth keeping current. */
export async function hasFulfillmentPlan(quotationId: string): Promise<boolean> {
  const count = await prisma.fulfillmentPlan.count({
    where: { quotationId, status: { in: ["RECOMMENDED", "ALTERNATIVE", "ACCEPTED"] } },
  });
  return count > 0;
}

// ---------------------------------------------------------------------------
// 2. Authoritative allocation (D4, D13) - reserves stock
// ---------------------------------------------------------------------------

export interface AllocateResult {
  allocations: { lineId: string; warehouseId: string; quantity: number }[];
  backorders: { lineId: string; quantity: number }[];
  shipmentCount: number;
  shippingCost: Prisma.Decimal;
  /** D15 - what the pre-flight said versus what the stock actually allowed. */
  variance: {
    plannedShipmentCount: number | null;
    actualShipmentCount: number;
    changed: boolean;
    note: string;
  };
}

/**
 * Allocate and reserve stock. Runs on order confirmation, never before.
 *
 * D13 - concurrency. Two orders confirmed at the same moment must not both
 * claim the last units. The stock rows are locked FOR UPDATE inside the
 * transaction, in a deterministic id order so two concurrent allocations cannot
 * deadlock by taking the same rows in opposite sequence.
 */
export async function allocateFulfillment(params: {
  quotationId: string;
  user: AuthzUser;
  /** Optional manual split. Recorded as an override when supplied. */
  override?: { lineId: string; warehouseId: string; quantity: number }[];
  reason?: string;
}): Promise<AllocateResult> {
  // D17 - Finance/Operations owns allocation; a rep can watch but not decide.
  assertCan(params.user, "allocate");

  const quotation = await prisma.quotation.findUnique({
    where: { id: params.quotationId },
    select: { id: true, quoteNumber: true, approvalState: true },
  });
  if (!quotation) throw new NotFoundError(`Quotation ${params.quotationId} does not exist`);
  if (quotation.approvalState !== "APPROVED") {
    throw new ConflictError(
      `Quotation ${quotation.quoteNumber} is not approved, so stock cannot be allocated.`,
    );
  }

  const priorPlan = await prisma.fulfillmentPlan.findFirst({
    where: { quotationId: params.quotationId, status: { in: ["RECOMMENDED", "ACCEPTED"] } },
    orderBy: { createdAt: "desc" },
    select: { estimatedShipmentCount: true },
  });

  const now = currentBusinessTime();

  return prisma.$transaction(async (tx) => {
    // Lock every stock row that could be touched, ordered by id so concurrent
    // transactions always take them in the same sequence.
    await tx.$queryRaw`
      SELECT "id" FROM "WarehouseStock" ORDER BY "id" FOR UPDATE
    `;

    // Checked inside the lock, not before it. Outside, two confirmations
    // arriving together would both read zero and both allocate; the lock above
    // serialises them, so the second one sees the first one committed.
    const existing = await tx.fulfillmentAllocation.count({
      where: { quotationId: params.quotationId, status: { not: "CANCELLED" } },
    });
    if (existing > 0) {
      throw new ConflictError(
        `Quotation ${quotation.quoteNumber} has already been allocated.`,
      );
    }

    // Re-read stock *inside* the lock: the pre-flight figure may be minutes old.
    const { demand, warehouses } = await readDemandAndSupply(params.quotationId);

    const plan: AllocationPlan = params.override
      ? buildOverridePlan(params.override, demand, warehouses)
      : planAllocation({ demand, warehouses }).recommended;

    for (const pick of plan.picks) {
      const line = demand.find((d) => d.lineId === pick.lineId);
      if (!line) continue;

      const row = await tx.warehouseStock.findFirst({
        where: {
          warehouseId: pick.warehouseId,
          productId: line.productId,
          variantId: line.variantId ?? null,
        },
      });
      if (!row) {
        throw new ValidationError(
          `No stock record at the chosen warehouse for ${line.label ?? line.productId}.`,
          "warehouseId",
        );
      }
      if (row.availableQuantity - row.reservedQuantity < pick.quantity) {
        throw new ConflictError(
          `Stock at ${pick.warehouseName} changed while allocating; retry the allocation.`,
        );
      }

      await tx.warehouseStock.update({
        where: { id: row.id },
        data: { reservedQuantity: row.reservedQuantity + pick.quantity, updatedAt: now },
      });

      await tx.fulfillmentAllocation.create({
        data: {
          quotationId: params.quotationId,
          quotationLineId: pick.lineId,
          warehouseId: pick.warehouseId,
          requestedQuantity: line.quantity,
          allocatedQuantity: pick.quantity,
          status: "RESERVED",
          isManualOverride: Boolean(params.override),
          createdAt: now,
          updatedAt: now,
        },
      });
    }

    for (const shortfall of plan.shortfalls) {
      await tx.backorder.create({
        data: {
          quotationId: params.quotationId,
          quotationLineId: shortfall.lineId,
          quantity: shortfall.quantity,
          status: "OPEN",
          createdAt: now,
          updatedAt: now,
        },
      });
    }

    await tx.fulfillmentPlan.updateMany({
      where: { quotationId: params.quotationId, status: "RECOMMENDED" },
      data: { status: "ACCEPTED" },
    });

    const changed =
      priorPlan !== null && priorPlan.estimatedShipmentCount !== plan.shipmentCount;

    return {
      allocations: plan.picks.map((p) => ({
        lineId: p.lineId,
        warehouseId: p.warehouseId,
        quantity: p.quantity,
      })),
      backorders: plan.shortfalls.map((s) => ({ lineId: s.lineId, quantity: s.quantity })),
      shipmentCount: plan.shipmentCount,
      shippingCost: plan.shippingCost,
      variance: {
        plannedShipmentCount: priorPlan?.estimatedShipmentCount ?? null,
        actualShipmentCount: plan.shipmentCount,
        changed,
        note: changed
          ? `Stock moved since the pre-flight: planned ${priorPlan?.estimatedShipmentCount} shipments, allocated ${plan.shipmentCount}`
          : "Allocation matches the pre-flight plan",
      },
    };
  });
}

/** Turn a human-chosen split into a plan the writer can consume. */
function buildOverridePlan(
  override: { lineId: string; warehouseId: string; quantity: number }[],
  demand: DemandLine[],
  warehouses: WarehouseSnapshot[],
): AllocationPlan {
  const byId = new Map(warehouses.map((w) => [w.warehouseId, w]));

  const picks = override.map((o) => {
    const warehouse = byId.get(o.warehouseId);
    if (!warehouse) {
      throw new ValidationError(`Unknown warehouse ${o.warehouseId}.`, "warehouseId");
    }
    if (o.quantity <= 0) {
      throw new ValidationError("Override quantities must be positive.", "quantity");
    }
    return {
      lineId: o.lineId,
      warehouseId: o.warehouseId,
      warehouseName: warehouse.warehouseName,
      quantity: o.quantity,
    };
  });

  const warehouseIds = [...new Set(picks.map((p) => p.warehouseId))];
  const shippingCost = warehouseIds.reduce(
    (acc, id) => acc.plus(new Decimal(byId.get(id)?.perShipmentCost ?? 0)),
    new Decimal(0),
  );

  const shortfalls = demand
    .map((line) => {
      const allocated = picks
        .filter((p) => p.lineId === line.lineId)
        .reduce((acc, p) => acc + p.quantity, 0);
      return { lineId: line.lineId, label: line.label, quantity: line.quantity - allocated };
    })
    .filter((s) => s.quantity > 0);

  return {
    picks,
    shortfalls,
    warehouseIds,
    shipmentCount: warehouseIds.length,
    shippingCost,
    strategy: "PRIORITY_ORDER",
    rationale: "Manual override chosen by an operator",
  };
}

// ---------------------------------------------------------------------------
// 3. Manual override (audited against the recommendation)
// ---------------------------------------------------------------------------

/**
 * Allocate using a human-chosen split.
 *
 * The audit entry carries *both* the split the system recommended and the one
 * the operator chose, so it is always possible to see what was overridden and
 * not merely that something was.
 */
export async function overrideAllocation(params: {
  quotationId: string;
  user: AuthzUser;
  picks: { lineId: string; warehouseId: string; quantity: number }[];
  reason: string;
}): Promise<AllocateResult> {
  assertCan(params.user, "allocate");

  if (!params.reason?.trim()) {
    throw new ValidationError("An override needs a reason.", "reason");
  }

  const { demand, warehouses } = await readDemandAndSupply(params.quotationId);
  const recommended = planAllocation({ demand, warehouses }).recommended;

  const result = await allocateFulfillment({
    quotationId: params.quotationId,
    user: params.user,
    override: params.picks,
    reason: params.reason,
  });

  await appendAudit({
    entityName: "Quotation",
    entityId: params.quotationId,
    action: "OVERRIDE",
    actorId: params.user.id,
    reason: params.reason,
    fieldChanges: {
      recommended: recommended.picks.map((p) => ({
        warehouse: p.warehouseName,
        lineId: p.lineId,
        quantity: p.quantity,
      })),
      chosen: params.picks,
      recommendedShipments: recommended.shipmentCount,
      chosenShipments: result.shipmentCount,
    },
  });

  return result;
}

// ---------------------------------------------------------------------------
// 4. Stock receipt and backorder consolidation
// ---------------------------------------------------------------------------

export interface ConsolidationCandidate {
  backorderId: string;
  quotationId: string;
  quoteNumber: string;
  quantity: number;
  warehouseId: string;
  warehouseName: string;
}

/**
 * Record a stock receipt, then check what it unblocks.
 *
 * §B6 says the "Consolidate Remaining Backorder" prompt appears automatically,
 * so the check is triggered by the receipt rather than polled. This is the
 * standalone equivalent of hooking a stock movement.
 */
export async function receiveStock(params: {
  warehouseId: string;
  productId: string;
  variantId?: string | null;
  quantity: number;
  actorId?: string | null;
}): Promise<{ available: number; consolidatable: ConsolidationCandidate[] }> {
  if (params.quantity <= 0) {
    throw new ValidationError("Receipt quantity must be positive.", "quantity");
  }

  const now = currentBusinessTime();
  const existing = await prisma.warehouseStock.findFirst({
    where: {
      warehouseId: params.warehouseId,
      productId: params.productId,
      variantId: params.variantId ?? null,
    },
  });

  const row = existing
    ? await prisma.warehouseStock.update({
        where: { id: existing.id },
        data: { availableQuantity: existing.availableQuantity + params.quantity, updatedAt: now },
      })
    : await prisma.warehouseStock.create({
        data: {
          warehouseId: params.warehouseId,
          productId: params.productId,
          variantId: params.variantId ?? null,
          availableQuantity: params.quantity,
          updatedAt: now,
        },
      });

  await appendAudit({
    entityName: "WarehouseStock",
    entityId: row.id,
    action: "UPDATE",
    actorId: params.actorId ?? null,
    reason: "Stock received",
    fieldChanges: { received: params.quantity, available: row.availableQuantity },
  });

  return {
    available: row.availableQuantity,
    consolidatable: await findConsolidatableBackorders(params.warehouseId),
  };
}

/**
 * Open backorders this warehouse can now cover in full.
 *
 * Partial coverage is deliberately not offered: consolidating half a backorder
 * turns one late shipment into two, which is the opposite of the point.
 */
export async function findConsolidatableBackorders(
  warehouseId: string,
): Promise<ConsolidationCandidate[]> {
  const warehouse = await prisma.warehouse.findUnique({
    where: { id: warehouseId },
    include: { stock: true },
  });
  if (!warehouse) return [];

  const free = new Map(
    warehouse.stock.map((s) => [
      stockKey(s.productId, s.variantId),
      Math.max(0, s.availableQuantity - s.reservedQuantity),
    ]),
  );

  const open = await prisma.backorder.findMany({
    where: { status: "OPEN" },
    include: {
      quotation: { select: { quoteNumber: true } },
      quotationLine: { select: { productId: true, variantId: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const candidates: ConsolidationCandidate[] = [];
  for (const backorder of open) {
    const key = stockKey(backorder.quotationLine.productId, backorder.quotationLine.variantId);
    const available = free.get(key) ?? 0;
    if (available < backorder.quantity) continue;

    candidates.push({
      backorderId: backorder.id,
      quotationId: backorder.quotationId,
      quoteNumber: backorder.quotation.quoteNumber,
      quantity: backorder.quantity,
      warehouseId,
      warehouseName: warehouse.name,
    });
    // Tentatively spoken for, so two backorders do not both claim the same units.
    free.set(key, available - backorder.quantity);
  }

  return candidates;
}

/** Fulfil a backorder from newly arrived stock. */
export async function consolidateBackorder(params: {
  backorderId: string;
  warehouseId: string;
  user: AuthzUser;
}): Promise<void> {
  assertCan(params.user, "allocate");

  const backorder = await prisma.backorder.findUnique({
    where: { id: params.backorderId },
    include: { quotationLine: { select: { productId: true, variantId: true } } },
  });
  if (!backorder) throw new NotFoundError(`Backorder ${params.backorderId} does not exist`);
  if (backorder.status !== "OPEN") {
    throw new ConflictError("This backorder is no longer open.");
  }

  const now = currentBusinessTime();

  await prisma.$transaction(async (tx) => {
    const row = await tx.warehouseStock.findFirst({
      where: {
        warehouseId: params.warehouseId,
        productId: backorder.quotationLine.productId,
        variantId: backorder.quotationLine.variantId ?? null,
      },
    });
    if (!row || row.availableQuantity - row.reservedQuantity < backorder.quantity) {
      throw new ConflictError("Not enough free stock to consolidate this backorder.");
    }

    await tx.warehouseStock.update({
      where: { id: row.id },
      data: { reservedQuantity: row.reservedQuantity + backorder.quantity, updatedAt: now },
    });

    await tx.fulfillmentAllocation.create({
      data: {
        quotationId: backorder.quotationId,
        quotationLineId: backorder.quotationLineId,
        warehouseId: params.warehouseId,
        requestedQuantity: backorder.quantity,
        allocatedQuantity: backorder.quantity,
        status: "RESERVED",
        createdAt: now,
        updatedAt: now,
      },
    });

    await tx.backorder.update({
      where: { id: backorder.id },
      data: { status: "CONSOLIDATED", warehouseId: params.warehouseId, updatedAt: now },
    });
  });

  await appendAudit({
    entityName: "Quotation",
    entityId: backorder.quotationId,
    action: "ALLOCATE",
    actorId: params.user.id,
    reason: "Backorder consolidated from newly received stock",
    fieldChanges: { backorderId: backorder.id, quantity: backorder.quantity },
  });
}

// ---------------------------------------------------------------------------
// 5. Reading the fulfilment picture
// ---------------------------------------------------------------------------

export interface FulfillmentPlanView {
  planId: string;
  status: string;
  isRunnerUp: boolean;
  shipmentCount: number;
  shippingCost: string;
  rationale: string | null;
  /** How old the stock reading behind this plan is (D4 - it can go stale). */
  stockSnapshotAt: Date;
  lines: { lineId: string; productName: string; warehouseName: string; quantity: number }[];
}

export interface FulfillmentView {
  quotationId: string;
  quoteNumber: string;
  recommended: FulfillmentPlanView | null;
  /** D8 - the trade-off, so the screen can show a choice rather than a verdict. */
  alternative: FulfillmentPlanView | null;
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
    expectedDate: Date | null;
  }[];
  shipments: {
    id: string;
    shipmentNumber: string;
    warehouseName: string;
    status: string;
    shippingCost: string;
    estimatedDeliveryDate: Date | null;
    actualDeliveryDate: Date | null;
    /** Late, or overdue and still undelivered. */
    slipped: boolean;
  }[];
}

/**
 * Everything the fulfilment screen needs, in one read.
 *
 * The plan lines were previously written and never read back, which meant the
 * split existed in the database but could not be shown to anyone.
 */
export async function getFulfillmentView(
  user: AuthzUser,
  quotationId: string,
): Promise<FulfillmentView> {
  // The runner-up plan we kept (D8) is our sourcing reasoning, not the
  // customer's - so the shape is asserted here, not merely the row.
  assertCan(user, "view", "fulfilmentProgress");

  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    include: {
      lines: { include: { product: { select: { name: true } } } },
      fulfillmentPlans: {
        where: { status: { in: ["RECOMMENDED", "ACCEPTED", "ALTERNATIVE"] } },
        orderBy: { createdAt: "desc" },
        include: { lines: true },
      },
      allocations: { include: { warehouse: { select: { name: true } } } },
      backorders: true,
      shipments: { include: { warehouse: { select: { name: true } } } },
    },
  });
  if (!quotation) throw new NotFoundError(`Quotation ${quotationId} does not exist`);

  const productByLine = new Map(quotation.lines.map((l) => [l.id, l.product.name]));
  const warehouses = await prisma.warehouse.findMany({ select: { id: true, name: true } });
  const warehouseName = new Map(warehouses.map((w) => [w.id, w.name]));
  const now = currentBusinessTime();

  const toPlanView = (
    plan: (typeof quotation.fulfillmentPlans)[number],
  ): FulfillmentPlanView => ({
    planId: plan.id,
    status: plan.status,
    isRunnerUp: plan.isRunnerUp,
    shipmentCount: plan.estimatedShipmentCount,
    shippingCost: plan.estimatedShippingCost.toFixed(2),
    rationale: plan.rationale,
    stockSnapshotAt: plan.stockSnapshotAt,
    lines: plan.lines.map((l) => ({
      lineId: l.quotationLineId,
      productName: productByLine.get(l.quotationLineId) ?? "",
      warehouseName: warehouseName.get(l.warehouseId) ?? "",
      quantity: l.quantity,
    })),
  });

  const recommended = quotation.fulfillmentPlans.find(
    (p) => p.status === "RECOMMENDED" || p.status === "ACCEPTED",
  );
  const alternative = quotation.fulfillmentPlans.find((p) => p.status === "ALTERNATIVE");

  return {
    quotationId,
    quoteNumber: quotation.quoteNumber,
    recommended: recommended ? toPlanView(recommended) : null,
    alternative: alternative ? toPlanView(alternative) : null,
    allocations: quotation.allocations.map((a) => ({
      id: a.id,
      lineId: a.quotationLineId,
      productName: productByLine.get(a.quotationLineId) ?? "",
      warehouseName: a.warehouse.name,
      requestedQuantity: a.requestedQuantity,
      allocatedQuantity: a.allocatedQuantity,
      status: a.status,
      isManualOverride: a.isManualOverride,
    })),
    backorders: quotation.backorders.map((b) => ({
      id: b.id,
      lineId: b.quotationLineId,
      productName: productByLine.get(b.quotationLineId) ?? "",
      quantity: b.quantity,
      status: b.status,
      expectedDate: b.expectedDate,
    })),
    shipments: quotation.shipments.map((sh) => ({
      id: sh.id,
      shipmentNumber: sh.shipmentNumber,
      warehouseName: sh.warehouse.name,
      status: sh.status,
      shippingCost: sh.shippingCost.toFixed(2),
      estimatedDeliveryDate: sh.estimatedDeliveryDate,
      actualDeliveryDate: sh.actualDeliveryDate,
      slipped: hasSlipped(sh, now),
    })),
  };
}

// ---------------------------------------------------------------------------
// 6. Shipments and delivery slippage
// ---------------------------------------------------------------------------

interface ShipmentLike {
  status: string;
  estimatedDeliveryDate: Date | null;
  actualDeliveryDate: Date | null;
}

/**
 * A shipment has slipped if it arrived after it was promised, or if the promise
 * has passed and nothing has arrived.
 *
 * §B9 asks for "delivery promise slippage indicators", which needs both a
 * promise and an outcome - the reason Shipment carries two dates rather than
 * one.
 */
export function hasSlipped(shipment: ShipmentLike, asOf: Date): boolean {
  if (!shipment.estimatedDeliveryDate) return false;
  if (shipment.status === "CANCELLED") return false;

  if (shipment.actualDeliveryDate) {
    return shipment.actualDeliveryDate.getTime() > shipment.estimatedDeliveryDate.getTime();
  }
  return asOf.getTime() > shipment.estimatedDeliveryDate.getTime();
}

/**
 * Dispatch everything reserved at one warehouse as a single shipment.
 *
 * One shipment per warehouse is the same unit the allocator counted and costed
 * (D9), so the promise made here matches the plan the customer was shown.
 */
export async function dispatchShipment(params: {
  quotationId: string;
  warehouseId: string;
  user: AuthzUser;
  estimatedDeliveryDate?: Date | null;
}): Promise<{ shipmentId: string; shipmentNumber: string; allocations: number }> {
  assertCan(params.user, "allocate");

  const warehouse = await prisma.warehouse.findUnique({ where: { id: params.warehouseId } });
  if (!warehouse) throw new NotFoundError(`Warehouse ${params.warehouseId} does not exist`);

  const reserved = await prisma.fulfillmentAllocation.findMany({
    where: {
      quotationId: params.quotationId,
      warehouseId: params.warehouseId,
      status: "RESERVED",
    },
  });
  if (reserved.length === 0) {
    throw new ConflictError("Nothing is reserved at this warehouse to dispatch.");
  }

  const now = currentBusinessTime();

  const shipment = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK.stockAllocation})`;
    const count = await tx.shipment.count();

    const created = await tx.shipment.create({
      data: {
        shipmentNumber: `SHP-${now.getUTCFullYear()}-${String(count + 1).padStart(4, "0")}`,
        quotationId: params.quotationId,
        warehouseId: params.warehouseId,
        status: "DISPATCHED",
        shippingCost: warehouse.shippingCost,
        estimatedDeliveryDate: params.estimatedDeliveryDate ?? null,
        createdAt: now,
        updatedAt: now,
      },
    });

    await tx.fulfillmentAllocation.updateMany({
      where: { id: { in: reserved.map((r) => r.id) } },
      data: { status: "SHIPPED", updatedAt: now },
    });

    // Reserved stock has now physically left the building, so it stops being
    // both on hand and reserved.
    for (const allocation of reserved) {
      const line = await tx.quotationLine.findUniqueOrThrow({
        where: { id: allocation.quotationLineId },
        select: { productId: true, variantId: true },
      });
      const row = await tx.warehouseStock.findFirst({
        where: {
          warehouseId: params.warehouseId,
          productId: line.productId,
          variantId: line.variantId ?? null,
        },
      });
      if (!row) continue;
      await tx.warehouseStock.update({
        where: { id: row.id },
        data: {
          availableQuantity: Math.max(0, row.availableQuantity - allocation.allocatedQuantity),
          reservedQuantity: Math.max(0, row.reservedQuantity - allocation.allocatedQuantity),
          updatedAt: now,
        },
      });
    }

    return created;
  });

  await appendAudit({
    entityName: "Quotation",
    entityId: params.quotationId,
    action: "ALLOCATE",
    actorId: params.user.id,
    reason: `Dispatched from ${warehouse.name}`,
    fieldChanges: {
      shipmentNumber: shipment.shipmentNumber,
      allocations: reserved.length,
      promisedFor: params.estimatedDeliveryDate?.toISOString() ?? null,
    },
  });

  return {
    shipmentId: shipment.id,
    shipmentNumber: shipment.shipmentNumber,
    allocations: reserved.length,
  };
}

/** Record arrival. Late arrivals are what the slippage indicator reads. */
export async function recordDelivery(params: {
  shipmentId: string;
  user: AuthzUser;
  deliveredAt?: Date;
}): Promise<{ slipped: boolean; daysLate: number }> {
  assertCan(params.user, "allocate");

  const shipment = await prisma.shipment.findUnique({ where: { id: params.shipmentId } });
  if (!shipment) throw new NotFoundError(`Shipment ${params.shipmentId} does not exist`);
  if (shipment.status === "DELIVERED") {
    throw new ConflictError("This shipment is already recorded as delivered.");
  }

  const now = currentBusinessTime();
  const deliveredAt = params.deliveredAt ?? now;

  const updated = await prisma.shipment.update({
    where: { id: shipment.id },
    data: { status: "DELIVERED", actualDeliveryDate: deliveredAt, updatedAt: now },
  });

  const slipped = hasSlipped(updated, now);
  const daysLate =
    slipped && updated.estimatedDeliveryDate
      ? Math.max(
          0,
          Math.floor(
            (deliveredAt.getTime() - updated.estimatedDeliveryDate.getTime()) / 86_400_000,
          ),
        )
      : 0;

  await appendAudit({
    entityName: "Quotation",
    entityId: shipment.quotationId,
    action: "UPDATE",
    actorId: params.user.id,
    reason: slipped ? `Delivered ${daysLate} day(s) late` : "Delivered on time",
    fieldChanges: {
      shipmentNumber: shipment.shipmentNumber,
      promisedFor: updated.estimatedDeliveryDate?.toISOString() ?? null,
      deliveredAt: deliveredAt.toISOString(),
    },
  });

  return { slipped, daysLate };
}

export interface SlippedShipment {
  shipmentId: string;
  shipmentNumber: string;
  quotationId: string;
  quoteNumber: string;
  warehouseName: string;
  estimatedDeliveryDate: Date;
  actualDeliveryDate: Date | null;
  daysLate: number;
}

/** Every shipment that broke its promise, for the deal-health dashboard. */
export async function findSlippedShipments(asOf?: Date): Promise<SlippedShipment[]> {
  const at = asOf ?? currentBusinessTime();

  const shipments = await prisma.shipment.findMany({
    where: { estimatedDeliveryDate: { not: null }, status: { not: "CANCELLED" } },
    include: {
      quotation: { select: { quoteNumber: true } },
      warehouse: { select: { name: true } },
    },
  });

  return shipments
    .filter((sh) => hasSlipped(sh, at))
    .map((sh) => {
      const promised = sh.estimatedDeliveryDate as Date;
      const reference = sh.actualDeliveryDate ?? at;
      return {
        shipmentId: sh.id,
        shipmentNumber: sh.shipmentNumber,
        quotationId: sh.quotationId,
        quoteNumber: sh.quotation.quoteNumber,
        warehouseName: sh.warehouse.name,
        estimatedDeliveryDate: promised,
        actualDeliveryDate: sh.actualDeliveryDate,
        daysLate: Math.max(
          0,
          Math.floor((reference.getTime() - promised.getTime()) / 86_400_000),
        ),
      };
    })
    .sort((a, b) => b.daysLate - a.daysLate);
}
