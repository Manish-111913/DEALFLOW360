import { Prisma } from "../generated/prisma/client";
import { assertCan, type AuthzUser } from "../authz/roles";
import { prisma } from "../db";
import { NotFoundError, ValidationError } from "../errors";
import { resolveApprovalRoute } from "../engines/approval-routing";
import { computeOrderMargin, type MarginLineInput } from "../engines/margin";
import { computeRisk, type DeliveryRisk } from "../engines/risk";
import type { RiskLevel } from "../generated/prisma/enums";
import { getSettings } from "../settings";
import { loadActiveApprovalSteps } from "./approvals";
import { resolveCeilings } from "./discount-policy";
import { assertQuotationVisible } from "./quotations";

const Decimal = Prisma.Decimal;

/**
 * What-if analysis: the real engines, on hypothetical lines, writing nothing.
 *
 * The point of this file is that a simulated number is not a different kind of
 * number. `recomputeQuotation` runs ceilings -> margin -> risk -> routing; so
 * does this, against the same settings and the same approval chain. A scenario
 * that says "margin becomes 27.1%" is stating what the margin engine actually
 * returns for those lines, not an estimate and not a model's arithmetic.
 *
 * Two things are deliberately left out of the chain:
 *
 *  - Nothing is persisted. There is no transaction here at all, so a simulation
 *    cannot leave a trace on the quotation or its audit history.
 *  - Fulfilment is not re-planned. `planFulfillment` reserves nothing but does
 *    write a plan row, and the delivery risk of the current plan is carried
 *    over instead. A discount change does not move stock, so that is also the
 *    honest input.
 */

export type ScenarioChange =
  | { kind: "setLineDiscount"; lineId: string; discountPercentage: string }
  | { kind: "setAllDiscounts"; discountPercentage: string }
  | { kind: "setQuantity"; lineId: string; quantity: number }
  | { kind: "removeLine"; lineId: string }
  | { kind: "addProduct"; productId: string; quantity: number; discountPercentage?: string };

export interface SimulatedLine {
  lineId: string;
  productName: string;
  quantity: number;
  unitPrice: string;
  discountPercentage: string;
  discountCeiling: string;
  overCeilingBy: string | null;
  lineTotal: string;
  marginPercentage: string;
  /** True for a line this scenario introduced rather than modified. */
  added: boolean;
}

export interface SimulationResult {
  quotationId: string;
  label: string;
  revenue: string;
  discountAmount: string;
  totalCost: string;
  grossMargin: string;
  marginPercentage: string;
  riskScore: number;
  riskLevel: RiskLevel;
  anyLineOverCeiling: boolean;
  approvalRequired: boolean;
  approvalReason: string;
  /** Which role would have to approve, or null when none is required. */
  approverRole: string | null;
  lines: SimulatedLine[];
  /** Signed differences against the quotation as it stands today. */
  delta: {
    revenue: string;
    marginPercentage: string;
    riskScore: number;
  } | null;
  explain: {
    margin: ReturnType<typeof computeOrderMargin>["explain"];
    risk: ReturnType<typeof computeRisk>["explain"];
    routing: ReturnType<typeof resolveApprovalRoute>["explain"];
  };
}

interface WorkingLine {
  lineId: string;
  productName: string;
  categoryId: string;
  quantity: number;
  unitPrice: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  discountPercentage: Prisma.Decimal;
  added: boolean;
}

function percentage(raw: string, field: string): Prisma.Decimal {
  const value = new Decimal(raw);
  if (value.lessThan(0) || value.greaterThan(100)) {
    throw new ValidationError(`${field} must be between 0 and 100`);
  }
  return value;
}

/** Apply one change to the working set. Order matters, so this stays a fold. */
async function applyChange(lines: WorkingLine[], change: ScenarioChange): Promise<WorkingLine[]> {
  switch (change.kind) {
    case "setAllDiscounts": {
      const discount = percentage(change.discountPercentage, "discountPercentage");
      return lines.map((line) => ({ ...line, discountPercentage: discount }));
    }

    case "setLineDiscount": {
      const discount = percentage(change.discountPercentage, "discountPercentage");
      if (!lines.some((line) => line.lineId === change.lineId)) {
        throw new NotFoundError(`Line ${change.lineId} is not on this quotation`);
      }
      return lines.map((line) =>
        line.lineId === change.lineId ? { ...line, discountPercentage: discount } : line,
      );
    }

    case "setQuantity": {
      if (change.quantity < 1) throw new ValidationError("quantity must be at least 1");
      return lines.map((line) =>
        line.lineId === change.lineId ? { ...line, quantity: change.quantity } : line,
      );
    }

    case "removeLine":
      return lines.filter((line) => line.lineId !== change.lineId);

    case "addProduct": {
      if (change.quantity < 1) throw new ValidationError("quantity must be at least 1");
      const product = await prisma.product.findUnique({
        where: { id: change.productId },
        select: { id: true, name: true, categoryId: true, basePrice: true, costPrice: true },
      });
      if (!product) throw new NotFoundError(`Product ${change.productId} does not exist`);

      return [
        ...lines,
        {
          // Marked so the screen can label it, and so it can never collide with
          // a real line id.
          lineId: `simulated:${product.id}`,
          productName: product.name,
          categoryId: product.categoryId,
          quantity: change.quantity,
          unitPrice: product.basePrice,
          unitCost: product.costPrice,
          discountPercentage: change.discountPercentage
            ? percentage(change.discountPercentage, "discountPercentage")
            : new Decimal(0),
          added: true,
        },
      ];
    }
  }
}

/**
 * Run one scenario.
 *
 * `label` is the caller's name for it ("Alternative B"), carried through so the
 * comparison table can be built without the caller re-pairing results to names.
 */
export async function simulateQuotation(
  user: AuthzUser,
  quotationId: string,
  changes: ScenarioChange[],
  label = "Scenario",
): Promise<SimulationResult> {
  assertCan(user, "view", "margin");
  await assertQuotationVisible(user, quotationId);

  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    include: {
      customer: { select: { tier: true } },
      lines: {
        orderBy: { sequence: "asc" },
        include: { product: { select: { name: true, categoryId: true } } },
      },
    },
  });
  if (!quotation) throw new NotFoundError(`Quotation ${quotationId} does not exist`);

  const settings = await getSettings();

  // The delivery outlook is the current one: a commercial change does not move
  // stock, so re-planning would only add noise.
  const [openBackorders, plan] = await Promise.all([
    prisma.backorder.count({ where: { quotationId, status: "OPEN" } }),
    prisma.fulfillmentPlan.findFirst({
      where: { quotationId, status: { in: ["RECOMMENDED", "ACCEPTED"] } },
      orderBy: { createdAt: "desc" },
      select: { estimatedShipmentCount: true },
    }),
  ]);
  const deliveryRisk: DeliveryRisk =
    openBackorders > 0 ? "BACKORDER" : plan && plan.estimatedShipmentCount > 1 ? "SPLIT" : "NONE";

  let working: WorkingLine[] = quotation.lines.map((line) => ({
    lineId: line.id,
    productName: line.product.name,
    categoryId: line.product.categoryId,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    unitCost: line.unitCost,
    discountPercentage: line.discountPercentage,
    added: false,
  }));

  for (const change of changes) {
    working = await applyChange(working, change);
  }
  if (working.length === 0) {
    throw new ValidationError("A scenario must leave at least one line on the quotation");
  }

  // --- the same chain recomputeQuotation runs -----------------------------
  const ceilings = await resolveCeilings(
    quotation.customer.tier,
    working.map((line) => line.categoryId),
  );

  const marginInputs: MarginLineInput[] = working.map((line) => ({
    lineId: line.lineId,
    label: line.productName,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discountPercentage: line.discountPercentage,
    unitCost: line.unitCost,
  }));
  const margin = computeOrderMargin(marginInputs, {
    minorUnits: settings.currencyMinorUnits,
  });

  const risk = computeRisk({
    lines: working.map((line) => ({
      lineId: line.lineId,
      label: line.productName,
      discountPercentage: line.discountPercentage,
      discountCeiling: ceilings.get(line.categoryId)?.ceiling ?? new Decimal(0),
    })),
    marginPercentage: margin.marginPercentage,
    targetMarginPercentage: settings.targetMarginPercentage,
    negotiationCount: quotation.negotiationCount,
    deliveryRisk,
  });

  const routing = resolveApprovalRoute({
    steps: await loadActiveApprovalSteps(),
    score: risk.score,
    anyLineOverCeiling: risk.anyLineOverCeiling,
    maxLineDiscount: risk.maxLineDiscount,
  });

  const lines: SimulatedLine[] = working.map((line) => {
    const computed = margin.lines.find((l) => l.lineId === line.lineId);
    const ceiling = ceilings.get(line.categoryId)?.ceiling ?? new Decimal(0);
    const over = line.discountPercentage.greaterThan(ceiling)
      ? line.discountPercentage.minus(ceiling).toFixed(2)
      : null;

    return {
      lineId: line.lineId,
      productName: line.productName,
      quantity: line.quantity,
      unitPrice: line.unitPrice.toFixed(2),
      discountPercentage: line.discountPercentage.toFixed(2),
      discountCeiling: ceiling.toFixed(2),
      overCeilingBy: over,
      lineTotal: computed?.netSellingValue.toFixed(2) ?? "0.00",
      marginPercentage: computed?.marginPercentage.toFixed(2) ?? "0.00",
      added: line.added,
    };
  });

  // The delta is against the quotation as stored, so a scenario can be read
  // as a change rather than as an isolated set of numbers.
  const currentMargin = quotation.marginPercentage;
  const delta = {
    revenue: margin.netSellingValue
      .minus(quotation.subtotal.minus(quotation.discountAmount))
      .toFixed(2),
    marginPercentage: margin.marginPercentage.minus(currentMargin).toFixed(2),
    riskScore: risk.score - Number(quotation.riskScore),
  };

  return {
    quotationId,
    label,
    revenue: margin.netSellingValue.toFixed(2),
    discountAmount: margin.discountAmount.toFixed(2),
    totalCost: margin.estimatedCost.toFixed(2),
    grossMargin: margin.grossMargin.toFixed(2),
    marginPercentage: margin.marginPercentage.toFixed(2),
    riskScore: risk.score,
    riskLevel: risk.level,
    anyLineOverCeiling: risk.anyLineOverCeiling,
    approvalRequired: routing.required,
    approvalReason: routing.reason,
    approverRole: routing.steps[0]?.approverRole ?? null,
    lines,
    delta,
    explain: { margin: margin.explain, risk: risk.explain, routing: routing.explain },
  };
}

/** The quotation as it stands, in the same shape, so it compares like for like. */
export async function simulateCurrent(
  user: AuthzUser,
  quotationId: string,
): Promise<SimulationResult> {
  const result = await simulateQuotation(user, quotationId, [], "Current deal");
  // Nothing changed, so a delta against itself would be noise.
  return { ...result, delta: null };
}
