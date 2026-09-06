import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditTrailFor } from "../audit";
import { ForbiddenError, type AuthzUser } from "../authz/roles";
import { currentBusinessTime } from "../clock";
import { prisma } from "../db";
import { RECOMMENDED_ACTIONS } from "../engines/deal-health";
import {
  escalateDeal,
  getDealHealthDashboard,
  getHealthHistory,
  recomputeAllDealHealth,
  repRollingAverageDiscount,
  resolveAlert,
  resolveAlertAs,
  scoreDealHealth,
} from "./deal-health";
import { addQuotationLine, createQuotation } from "./quotations";

const DAY_MS = 86_400_000;

let acmeId: string;
let priyaId: string;
let rahulId: string;
let laptopId: string;
let manager: AuthzUser;
let rep: AuthzUser;
const created: string[] = [];

/**
 * The worked example, staged against real rows: inactive 5 days, pending
 * approval 2 days, an open backorder, one negotiation round.
 *
 * The line carries no discount so the anomaly penalty is zero - any rep
 * baseline is at least zero, so a zero-discount quote can never read as
 * anomalous. The anomaly path itself is covered by the engine tests.
 */
async function stalledDeal() {
  const now = currentBusinessTime();
  const q = await createQuotation({ customerId: acmeId, salesRepId: priyaId });
  created.push(q.id);

  const line = await addQuotationLine({
    quotationId: q.id,
    productId: laptopId,
    quantity: 4,
    discountPercentage: "0",
  });

  await prisma.quotation.update({
    where: { id: q.id },
    data: {
      approvalState: "PENDING_MANAGER",
      submittedAt: new Date(now.getTime() - 2 * DAY_MS),
      lastActivityAt: new Date(now.getTime() - 5 * DAY_MS),
      negotiationCount: 1,
    },
  });

  await prisma.backorder.create({
    data: {
      quotationId: q.id,
      quotationLineId: line.id,
      quantity: 2,
      status: "OPEN",
      createdAt: now,
      updatedAt: now,
    },
  });

  return { quotationId: q.id, lineId: line.id };
}

beforeAll(async () => {
  acmeId = (await prisma.customer.findUniqueOrThrow({ where: { name: "Acme Industries" } })).id;
  const priya = await prisma.user.findUniqueOrThrow({ where: { email: "priya@dealflow360.test" } });
  const rahul = await prisma.user.findUniqueOrThrow({ where: { email: "rahul@dealflow360.test" } });
  const m = await prisma.user.findUniqueOrThrow({ where: { email: "manager@dealflow360.test" } });
  priyaId = priya.id;
  rahulId = rahul.id;
  manager = { id: m.id, kind: "INTERNAL", role: "SALES_MANAGER", customerId: null, salesTeamId: m.salesTeamId };
  rep = { id: priya.id, kind: "INTERNAL", role: "SALES_REP", customerId: null, salesTeamId: priya.salesTeamId };

  laptopId = (await prisma.product.findUniqueOrThrow({ where: { sku: "HW-LAPTOP-PRO" } })).id;
});

afterAll(async () => {
  await prisma.quotation.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

describe("the frozen scenario scores 57 against real data", () => {
  it("computes each penalty from stored state", async () => {
    const { quotationId } = await stalledDeal();
    const result = await scoreDealHealth(quotationId);

    expect(result.penalties.stalled).toBe(15);
    expect(result.penalties.approvalDelay).toBe(8);
    expect(result.penalties.negotiation).toBe(5);
    expect(result.penalties.delivery).toBe(15);
    expect(result.penalties.discountAnomaly).toBe(0);
  });

  it("lands on 57, At Risk, with the documented action", async () => {
    const { quotationId } = await stalledDeal();
    const result = await scoreDealHealth(quotationId);

    expect(result.healthScore).toBe(57);
    expect(result.severity).toBe("AT_RISK");
    expect(result.recommendedAction).toBe(RECOMMENDED_ACTIONS.escalate);
  });

  it("stores the breakdown, not just the number", async () => {
    const { quotationId } = await stalledDeal();
    await scoreDealHealth(quotationId);

    const snapshot = await prisma.dealHealthSnapshot.findFirstOrThrow({
      where: { quotationId },
      orderBy: { computedAt: "desc" },
    });

    expect(snapshot.healthScore).toBe(57);
    expect(snapshot.stalledPenalty).toBe(15);
    expect(snapshot.approvalDelayPenalty).toBe(8);
    expect(snapshot.deliveryPenalty).toBe(15);
    expect(snapshot.recommendedAction).toBe(RECOMMENDED_ACTIONS.escalate);
  });

  // History rather than a single mutable row, so a manager sees a deal getting
  // worse rather than only that it is bad now.
  it("keeps snapshots as a trend", async () => {
    const { quotationId } = await stalledDeal();
    await scoreDealHealth(quotationId);
    await scoreDealHealth(quotationId);

    expect((await getHealthHistory(quotationId)).length).toBe(2);
  });
});

/** Acceptance: clearing the blockages lifts the deal on the next recompute. */
describe("recovery", () => {
  it("rises out of At Risk once the backorder and approval are cleared", async () => {
    const { quotationId } = await stalledDeal();
    expect((await scoreDealHealth(quotationId)).severity).toBe("AT_RISK");

    const now = currentBusinessTime();
    await prisma.backorder.updateMany({
      where: { quotationId },
      data: { status: "CONSOLIDATED" },
    });
    await prisma.quotation.update({
      where: { id: quotationId },
      data: { approvalState: "APPROVED", lastActivityAt: now },
    });

    const recovered = await scoreDealHealth(quotationId);

    expect(recovered.healthScore).toBe(95);
    expect(["WATCH", "HEALTHY"]).toContain(recovered.severity);
    expect(recovered.recommendedAction).toBe(RECOMMENDED_ACTIONS.monitor);
  });
});

/**
 * The signal that only works because B-5 seeded real order history: a discount
 * is judged against how this rep actually sells.
 */
describe("the discount baseline comes from real history", () => {
  it("reads a per-rep average from confirmed orders", async () => {
    const now = currentBusinessTime();
    const baseline = await repRollingAverageDiscount({
      salesRepId: priyaId,
      asOf: now,
      fallback: new (await import("../generated/prisma/client")).Prisma.Decimal(0),
    });

    expect(baseline.sampleSize).toBeGreaterThan(0);
    expect(["REP", "COMPANY"]).toContain(baseline.source);
    expect(baseline.average.greaterThan(0)).toBe(true);
  });

  it("gives the two reps different baselines, as seeded", async () => {
    const now = currentBusinessTime();
    const { Prisma } = await import("../generated/prisma/client");
    const zero = new Prisma.Decimal(0);

    const priya = await repRollingAverageDiscount({ salesRepId: priyaId, asOf: now, fallback: zero });
    const rahul = await repRollingAverageDiscount({ salesRepId: rahulId, asOf: now, fallback: zero });

    // Priya discounts harder than Rahul in the seeded history, so the same
    // quote is anomalous for one and unremarkable for the other.
    if (priya.source === "REP" && rahul.source === "REP") {
      expect(priya.average.greaterThan(rahul.average)).toBe(true);
    }
  });

  // A rep with no history must not have every quote read as an anomaly.
  it("falls back rather than inventing an anomaly", async () => {
    const now = currentBusinessTime();
    const { Prisma } = await import("../generated/prisma/client");

    const baseline = await repRollingAverageDiscount({
      salesRepId: "no-such-rep",
      asOf: now,
      fallback: new Prisma.Decimal("12.34"),
    });

    expect(["COMPANY", "FALLBACK"]).toContain(baseline.source);
  });
});

describe("escalation is idempotent", () => {
  it("creates exactly one alert however many times it is clicked", async () => {
    const { quotationId } = await stalledDeal();
    await scoreDealHealth(quotationId);

    // The score itself already raised an approval-delay alert, so an escalation
    // must recognise it rather than stack another on top.
    const first = await escalateDeal({ quotationId, user: manager });
    const second = await escalateDeal({ quotationId, user: manager });
    const third = await escalateDeal({ quotationId, user: manager });

    expect(second.alertId).toBe(first.alertId);
    expect(third.alertId).toBe(first.alertId);
    expect(second.created).toBe(false);

    const alerts = await prisma.dealAlert.findMany({
      where: { quotationId, type: "APPROVAL_DELAY" },
    });
    expect(alerts).toHaveLength(1);
  });

  it("allows a fresh escalation once the earlier one is resolved", async () => {
    const { quotationId } = await stalledDeal();
    await scoreDealHealth(quotationId);
    const first = await escalateDeal({ quotationId, user: manager });

    await resolveAlert({ alertId: first.alertId, user: manager });
    const again = await escalateDeal({ quotationId, user: manager });

    expect(again.created).toBe(true);
    expect(again.alertId).not.toBe(first.alertId);
  });

  it("is a manager action, not a rep one", async () => {
    const { quotationId } = await stalledDeal();
    await expect(escalateDeal({ quotationId, user: rep })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("audits the escalation", async () => {
    const { quotationId } = await stalledDeal();
    await scoreDealHealth(quotationId);
    await escalateDeal({ quotationId, user: manager });

    const trail = await auditTrailFor("Quotation", quotationId);
    expect(trail.some((e) => e.reason === "Deal escalated from the health dashboard")).toBe(true);
  });
});

describe("alerts do not pile up", () => {
  // The recompute runs repeatedly; creating unconditionally would bury the
  // dashboard in duplicates of the same problem within a day.
  it("raises one open alert per problem however often the score is recomputed", async () => {
    const { quotationId } = await stalledDeal();
    await scoreDealHealth(quotationId);
    await scoreDealHealth(quotationId);
    await scoreDealHealth(quotationId);

    const open = await prisma.dealAlert.findMany({ where: { quotationId, status: "OPEN" } });
    expect(open).toHaveLength(1);
  });

  it("raises nothing for a healthy deal", async () => {
    const q = await createQuotation({ customerId: acmeId, salesRepId: priyaId });
    created.push(q.id);
    await addQuotationLine({ quotationId: q.id, productId: laptopId, quantity: 1, discountPercentage: "0" });

    const result = await scoreDealHealth(q.id);
    expect(result.severity).toBe("HEALTHY");

    const alerts = await prisma.dealAlert.count({ where: { quotationId: q.id, status: "OPEN" } });
    expect(alerts).toBe(0);
  });
});

describe("the dashboard", () => {
  it("lists the worst deals first", async () => {
    await stalledDeal();
    const healthy = await createQuotation({ customerId: acmeId, salesRepId: priyaId });
    created.push(healthy.id);
    await addQuotationLine({
      quotationId: healthy.id,
      productId: laptopId,
      quantity: 1,
      discountPercentage: "0",
    });

    await recomputeAllDealHealth();
    const rows = await getDealHealthDashboard({ user: manager });

    expect(rows.length).toBeGreaterThan(0);
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i - 1].healthScore).toBeLessThanOrEqual(rows[i].healthScore);
    }
  });

  it("carries the recommended action and open alerts for each row", async () => {
    const { quotationId } = await stalledDeal();
    await scoreDealHealth(quotationId);

    const rows = await getDealHealthDashboard({ user: manager });
    const row = rows.find((r) => r.quotationId === quotationId)!;

    expect(row.recommendedAction).toBe(RECOMMENDED_ACTIONS.escalate);
    expect(row.stalledDays).toBe(5);
    expect(row.openAlerts.length).toBeGreaterThan(0);
  });

  it("filters by severity", async () => {
    const { quotationId } = await stalledDeal();
    await scoreDealHealth(quotationId);

    const atRisk = await getDealHealthDashboard({ user: manager, severities: ["AT_RISK"] });
    expect(atRisk.every((r) => r.severity === "AT_RISK")).toBe(true);
    expect(atRisk.some((r) => r.quotationId === quotationId)).toBe(true);
  });

  it("is refused to a rep", async () => {
    await expect(getDealHealthDashboard({ user: rep })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("closing an alert through the product", () => {
  it("resolves it and drops it off the board", async () => {
    const { quotationId } = await stalledDeal();
    await scoreDealHealth(quotationId);

    const before = (await getDealHealthDashboard({ user: manager })).find(
      (r) => r.quotationId === quotationId,
    )!;
    expect(before.openAlerts.length).toBeGreaterThan(0);

    const owner = await resolveAlertAs(manager, before.openAlerts[0].id);
    expect(owner).toBe(quotationId);

    const after = (await getDealHealthDashboard({ user: manager })).find(
      (r) => r.quotationId === quotationId,
    )!;
    expect(after.openAlerts.length).toBe(before.openAlerts.length - 1);
  });

  it("refuses a rep, who holds no escalate capability", async () => {
    const { quotationId } = await stalledDeal();
    await scoreDealHealth(quotationId);
    const row = (await getDealHealthDashboard({ user: manager })).find(
      (r) => r.quotationId === quotationId,
    )!;

    await expect(resolveAlertAs(rep, row.openAlerts[0].id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses an alert on a deal outside the caller's scope", async () => {
    // A manager is scoped to their own team. The primitive updates by alert id
    // alone, so without the wrapper this would silently close another team's
    // alert - which is exactly what the wrapper exists to stop.
    const { quotationId } = await stalledDeal();
    await scoreDealHealth(quotationId);
    const row = (await getDealHealthDashboard({ user: manager })).find(
      (r) => r.quotationId === quotationId,
    )!;

    const outsider: AuthzUser = {
      id: rahulId,
      kind: "INTERNAL",
      role: "SALES_MANAGER",
      customerId: null,
      // A team nobody is on, so their scope contains nothing of Priya's.
      salesTeamId: "team-that-does-not-exist",
    };

    await expect(resolveAlertAs(outsider, row.openAlerts[0].id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("refuses an alert that does not exist", async () => {
    await expect(resolveAlertAs(manager, "nope")).rejects.toMatchObject({ status: 404 });
  });
});
