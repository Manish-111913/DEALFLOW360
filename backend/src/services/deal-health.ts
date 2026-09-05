import { Prisma } from "../generated/prisma/client";
import type { AlertType, DealSeverity } from "../generated/prisma/enums";
import { appendAudit } from "../audit";
import { assertCan, type AuthzUser } from "../authz/roles";
import { scopeFor } from "../authz/scope";
import { currentBusinessTime } from "../clock";
import { prisma } from "../db";
import { isPendingApproval } from "../domain/approval";
import { NotFoundError } from "../errors";
import { findSlippedShipments } from "./fulfillment";
import {
  computeDealHealth,
  RECOMMENDED_ACTIONS,
  type DealHealthResult,
  type DeliveryState,
} from "../engines/deal-health";

/**
 * Deal health scoring, alerts and escalation.
 *
 * The engine does the arithmetic; this file gathers the facts it needs and
 * decides what to do with the answer.
 */

const Decimal = Prisma.Decimal;
const DAY_MS = 86_400_000;

/**
 * The window for a rep rolling discount average.
 *
 * 03_BUSINESS_RULES.md says "rep_rolling_3_month_average_discount", so this is
 * part of the frozen rule rather than a knob - unlike the weights, which are
 * also frozen, or the approval bands, which §A3 explicitly asks to be
 * configurable.
 */
const DISCOUNT_BASELINE_DAYS = 90;

function wholeDaysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));
}

// ---------------------------------------------------------------------------
// Gathering the facts
// ---------------------------------------------------------------------------

/**
 * The rep own recent discounting habit.
 *
 * A discount is only anomalous relative to how this particular rep normally
 * sells: 20% from someone who averages 18% is unremarkable, and alarming from
 * someone who averages 5%.
 *
 * Falls back to the company average, then to the quote itself. That last step
 * matters - a rep with no history must not have every quote read as an anomaly
 * simply because there is nothing to compare against.
 */
export async function repRollingAverageDiscount(params: {
  salesRepId: string;
  asOf: Date;
  fallback: Prisma.Decimal;
}): Promise<{ average: Prisma.Decimal; source: "REP" | "COMPANY" | "FALLBACK"; sampleSize: number }> {
  const since = new Date(params.asOf.getTime() - DISCOUNT_BASELINE_DAYS * DAY_MS);

  const rows = await prisma.$queryRaw<{ avg: number | null; n: number }[]>`
    SELECT AVG(l."discountPercentage")::float8 AS "avg", COUNT(*)::int AS "n"
      FROM "QuotationLine" l
      JOIN "Quotation" q ON q."id" = l."quotationId"
     WHERE q."salesRepId" = ${params.salesRepId}
       AND q."status" = 'CONFIRMED'
       AND q."confirmedAt" >= ${since}
  `;

  if (rows[0]?.avg !== null && rows[0] !== undefined && rows[0].n > 0) {
    return { average: new Decimal(rows[0].avg as number), source: "REP", sampleSize: rows[0].n };
  }

  const company = await prisma.$queryRaw<{ avg: number | null; n: number }[]>`
    SELECT AVG(l."discountPercentage")::float8 AS "avg", COUNT(*)::int AS "n"
      FROM "QuotationLine" l
      JOIN "Quotation" q ON q."id" = l."quotationId"
     WHERE q."status" = 'CONFIRMED'
       AND q."confirmedAt" >= ${since}
  `;

  if (company[0]?.avg !== null && company[0] !== undefined && company[0].n > 0) {
    return { average: new Decimal(company[0].avg as number), source: "COMPANY", sampleSize: company[0].n };
  }

  return { average: params.fallback, source: "FALLBACK", sampleSize: 0 };
}

/** Same delivery picture the risk engine reads, so the two never disagree. */
async function deliveryStateFor(quotationId: string): Promise<DeliveryState> {
  const [openBackorders, plan] = await Promise.all([
    prisma.backorder.count({ where: { quotationId, status: "OPEN" } }),
    prisma.fulfillmentPlan.findFirst({
      where: { quotationId, status: { in: ["RECOMMENDED", "ACCEPTED"] } },
      orderBy: { createdAt: "desc" },
      select: { estimatedShipmentCount: true },
    }),
  ]);

  if (openBackorders > 0) return "BACKORDER";
  if (plan && plan.estimatedShipmentCount > 1) return "SPLIT";
  return "NONE";
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface DealHealthSnapshotResult extends DealHealthResult {
  snapshotId: string;
  quotationId: string;
  quoteNumber: string;
  discountBaseline: { average: string; source: string; sampleSize: number };
}

/**
 * Score one quotation and store the result.
 *
 * Snapshots are kept as history rather than overwritten, so a manager can see a
 * deal getting worse rather than only that it is bad now.
 */
export async function scoreDealHealth(quotationId: string): Promise<DealHealthSnapshotResult> {
  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    include: { lines: { select: { discountPercentage: true } } },
  });
  if (!quotation) throw new NotFoundError(`Quotation ${quotationId} does not exist`);

  const now = currentBusinessTime();

  const averageDiscount = quotation.lines.length
    ? quotation.lines
        .reduce((acc, l) => acc.plus(l.discountPercentage), new Decimal(0))
        .dividedBy(quotation.lines.length)
    : new Decimal(0);

  const baseline = await repRollingAverageDiscount({
    salesRepId: quotation.salesRepId,
    asOf: now,
    fallback: averageDiscount,
  });

  const result = computeDealHealth({
    daysSinceLastActivity: wholeDaysBetween(quotation.lastActivityAt, now),
    daysPendingApproval:
      isPendingApproval(quotation.approvalState) && quotation.submittedAt
        ? wholeDaysBetween(quotation.submittedAt, now)
        : 0,
    negotiationRounds: quotation.negotiationCount,
    delivery: await deliveryStateFor(quotationId),
    averageDiscountOnQuote: averageDiscount,
    repRollingAverageDiscount: baseline.average,
  });

  const snapshot = await prisma.dealHealthSnapshot.create({
    data: {
      quotationId,
      riskScore: quotation.riskScore,
      healthScore: result.healthScore,
      severity: result.severity,
      stalledPenalty: result.penalties.stalled,
      approvalDelayPenalty: result.penalties.approvalDelay,
      negotiationPenalty: result.penalties.negotiation,
      deliveryPenalty: result.penalties.delivery,
      discountAnomalyPenalty: result.penalties.discountAnomaly,
      stalledDays: wholeDaysBetween(quotation.lastActivityAt, now),
      negotiationCount: quotation.negotiationCount,
      recommendedAction: result.recommendedAction,
      computedAt: now,
    },
  });

  await raiseAlertsFor({ quotationId, result, now });
  await raiseSlippageAlert({ quotationId, now, severity: result.severity });

  return {
    ...result,
    snapshotId: snapshot.id,
    quotationId,
    quoteNumber: quotation.quoteNumber,
    discountBaseline: {
      average: baseline.average.toFixed(2),
      source: baseline.source,
      sampleSize: baseline.sampleSize,
    },
  };
}

/**
 * Score every live deal.
 *
 * This is the "cron", and it is deliberately just a function: a scheduler or an
 * admin button can call it, and no queue or worker is involved (D1).
 */
export async function recomputeAllDealHealth(): Promise<{ scored: number }> {
  const live = await prisma.quotation.findMany({
    where: { status: { in: ["DRAFT", "SENT"] } },
    select: { id: true },
  });

  for (const q of live) {
    await scoreDealHealth(q.id);
  }
  return { scored: live.length };
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

/** Which alert a penalty profile warrants, if any. */
function alertTypeFor(result: DealHealthResult): AlertType | null {
  if (result.recommendedAction === RECOMMENDED_ACTIONS.escalate) return "APPROVAL_DELAY";
  if (result.recommendedAction === RECOMMENDED_ACTIONS.nudge) return "STALLED";
  if (result.penalties.discountAnomaly > 0) return "DISCOUNT_ANOMALY";
  if (result.penalties.delivery > 0) return "DELIVERY_SLIPPAGE";
  return null;
}

/**
 * Raise an alert, at most one open per quotation and type.
 *
 * The recompute runs repeatedly, so creating unconditionally would bury the
 * dashboard in duplicates of the same problem within a day.
 */
async function raiseAlertsFor(params: {
  quotationId: string;
  result: DealHealthResult;
  now: Date;
}): Promise<void> {
  const type = alertTypeFor(params.result);
  if (!type) return;
  if (params.result.severity === "HEALTHY") return;

  const existing = await prisma.dealAlert.findFirst({
    where: { quotationId: params.quotationId, type, status: "OPEN" },
  });
  if (existing) return;

  await prisma.dealAlert.create({
    data: {
      quotationId: params.quotationId,
      type,
      severity: params.result.severity,
      message: `${params.result.recommendedAction} - health ${params.result.healthScore}/100`,
      createdAt: params.now,
    },
  });
}

/** Marks an alert as having been pushed by a human, not merely computed. */
const ESCALATED_PREFIX = "ESCALATED: ";

/**
 * A broken delivery promise is its own alert.
 *
 * §B9 lists slippage alongside stalled deals and discount anomalies. It is not
 * a health *penalty* - the frozen rules score delivery on backorder and split
 * only - but a promise missed is exactly the kind of thing a manager should be
 * told about without having to open the order.
 */
async function raiseSlippageAlert(params: {
  quotationId: string;
  now: Date;
  severity: DealSeverity;
}): Promise<void> {
  const slipped = (await findSlippedShipments(params.now)).filter(
    (sh) => sh.quotationId === params.quotationId,
  );
  if (slipped.length === 0) return;

  const existing = await prisma.dealAlert.findFirst({
    where: { quotationId: params.quotationId, type: "DELIVERY_SLIPPAGE", status: "OPEN" },
  });
  if (existing) return;

  const worst = slipped[0];
  await prisma.dealAlert.create({
    data: {
      quotationId: params.quotationId,
      type: "DELIVERY_SLIPPAGE",
      severity: params.severity,
      message: `${worst.shipmentNumber} is ${worst.daysLate} day(s) past its promised date`,
      createdAt: params.now,
    },
  });
}

export interface EscalationResult {
  alertId: string;
  created: boolean;
}

/**
 * Escalate a deal to its manager.
 *
 * Idempotent on purpose: the acceptance is that clicking twice produces one
 * escalation, not two. A manager who receives the same nudge repeatedly stops
 * reading them.
 */
export async function escalateDeal(params: {
  quotationId: string;
  user: AuthzUser;
  note?: string;
}): Promise<EscalationResult> {
  assertCan(params.user, "escalate");

  const quotation = await prisma.quotation.findUnique({
    where: { id: params.quotationId },
    select: { id: true, quoteNumber: true },
  });
  if (!quotation) throw new NotFoundError(`Quotation ${params.quotationId} does not exist`);

  const latest = await prisma.dealHealthSnapshot.findFirst({
    where: { quotationId: params.quotationId },
    orderBy: { computedAt: "desc" },
  });

  const now = currentBusinessTime();
  const escalationNote =
    params.note ??
    `Escalated by ${params.user.role ?? "a manager"} - health ${latest?.healthScore ?? "unknown"}/100`;

  const existing = await prisma.dealAlert.findFirst({
    where: { quotationId: params.quotationId, type: "APPROVAL_DELAY", status: "OPEN" },
  });

  if (existing) {
    // Scoring already raised this alert, so a manual escalation adopts it
    // rather than stacking a second one. But a manager actively pushing a deal
    // is an action in its own right and has to leave a trace - once. The
    // ESCALATED marker is what makes the second and third click no-ops.
    if (existing.message.startsWith(ESCALATED_PREFIX)) {
      return { alertId: existing.id, created: false };
    }

    await prisma.dealAlert.update({
      where: { id: existing.id },
      data: { message: `${ESCALATED_PREFIX}${escalationNote}` },
    });

    await appendAudit({
      entityName: "Quotation",
      entityId: params.quotationId,
      action: "UPDATE",
      actorId: params.user.id,
      reason: "Deal escalated from the health dashboard",
      fieldChanges: { alertId: existing.id, healthScore: latest?.healthScore ?? null, adopted: true },
    });

    return { alertId: existing.id, created: false };
  }
  const alert = await prisma.dealAlert.create({
    data: {
      quotationId: params.quotationId,
      type: "APPROVAL_DELAY",
      severity: latest?.severity ?? ("AT_RISK" as DealSeverity),
      message: `${ESCALATED_PREFIX}${escalationNote}`,
      createdAt: now,
    },
  });

  await appendAudit({
    entityName: "Quotation",
    entityId: params.quotationId,
    action: "UPDATE",
    actorId: params.user.id,
    reason: "Deal escalated from the health dashboard",
    fieldChanges: { alertId: alert.id, healthScore: latest?.healthScore ?? null },
  });

  return { alertId: alert.id, created: true };
}

/** Close an alert once the underlying problem is dealt with. */
export async function resolveAlert(params: {
  alertId: string;
  user: AuthzUser;
}): Promise<void> {
  assertCan(params.user, "escalate");
  const now = currentBusinessTime();

  await prisma.dealAlert.updateMany({
    where: { id: params.alertId, status: { not: "RESOLVED" } },
    data: { status: "RESOLVED", resolvedAt: now },
  });
}

// ---------------------------------------------------------------------------
// The dashboard
// ---------------------------------------------------------------------------

export interface DashboardRow {
  quotationId: string;
  quoteNumber: string;
  customerName: string;
  salesRepName: string;
  healthScore: number;
  severity: DealSeverity;
  recommendedAction: string;
  stalledDays: number;
  computedAt: Date;
  openAlerts: { id: string; type: AlertType; message: string }[];
}

/**
 * Latest snapshot per deal, worst first, scoped to what the caller may see.
 *
 * §B9 asks for stalled deals, discount anomalies and delivery slippage; those
 * are the alert types, so a caller can filter on them rather than re-deriving.
 */
export async function getDealHealthDashboard(params: {
  user: AuthzUser;
  severities?: DealSeverity[];
}): Promise<DashboardRow[]> {
  assertCan(params.user, "view", "dealHealth");

  const scope = scopeFor(params.user, "Quotation");
  const quotations = await prisma.quotation.findMany({
    where: { AND: [{ status: { in: ["DRAFT", "SENT"] } }, scope] },
    include: {
      customer: { select: { name: true } },
      salesRep: { select: { name: true } },
      healthSnapshots: { orderBy: { computedAt: "desc" }, take: 1 },
      alerts: { where: { status: "OPEN" } },
    },
  });

  const rows: DashboardRow[] = quotations
    .filter((q) => q.healthSnapshots.length > 0)
    .map((q) => {
      const snapshot = q.healthSnapshots[0];
      return {
        quotationId: q.id,
        quoteNumber: q.quoteNumber,
        customerName: q.customer.name,
        salesRepName: q.salesRep.name,
        healthScore: snapshot.healthScore,
        severity: snapshot.severity,
        recommendedAction: snapshot.recommendedAction,
        stalledDays: snapshot.stalledDays,
        computedAt: snapshot.computedAt,
        openAlerts: q.alerts.map((a) => ({ id: a.id, type: a.type, message: a.message })),
      };
    })
    .filter((r) => !params.severities || params.severities.includes(r.severity));

  // Worst first: the dashboard exists to say which deal needs attention.
  return rows.sort((a, b) => a.healthScore - b.healthScore);
}

/** A deal trend, for the drill-down. */
export async function getHealthHistory(quotationId: string) {
  return prisma.dealHealthSnapshot.findMany({
    where: { quotationId },
    orderBy: { computedAt: "asc" },
  });
}
