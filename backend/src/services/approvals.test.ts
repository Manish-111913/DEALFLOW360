import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "../generated/prisma/client";
import type { AuthzUser } from "../authz/roles";
import { ForbiddenError } from "../authz/roles";
import { auditTrailFor } from "../audit";
import { prisma } from "../db";
import { ConflictError, ValidationError } from "../errors";
import { decideApproval, getApprovalOverview, submitForApproval } from "./approvals";
import { resolveDiscountCeiling } from "./discount-policy";
import { planFulfillment } from "./fulfillment";
import { addQuotationLine, createQuotation, recomputeQuotation } from "./quotations";

const D = (v: string | number) => new Prisma.Decimal(v);

let acmeId: string;
let repId: string;
let manager: AuthzUser;
let finance: AuthzUser;
let laptopId: string;
let setupId: string;
let onboardId: string;
let subscriptionId: string;
let mainStockId: string;
const created: string[] = [];

async function newQuotation() {
  const q = await createQuotation({ customerId: acmeId, salesRepId: repId });
  created.push(q.id);
  return q;
}

/** The three-line Acme quote the worked example describes. */
async function acmeScenario(options?: { negotiationRounds?: number; split?: boolean }) {
  const q = await newQuotation();
  await addQuotationLine({ quotationId: q.id, productId: laptopId, quantity: 10, discountPercentage: "12.00" });
  await addQuotationLine({ quotationId: q.id, productId: setupId, quantity: 1, discountPercentage: "18.00" });
  await addQuotationLine({ quotationId: q.id, productId: onboardId, quantity: 1, discountPercentage: "13.00" });

  if (options?.negotiationRounds) {
    await prisma.quotation.update({
      where: { id: q.id },
      data: { negotiationCount: options.negotiationRounds },
    });
  }

  if (options?.split) {
    // A real pre-flight, not a fixture. Main is held at 6 laptops for this file
    // (see beforeAll), so 10 units genuinely need both warehouses - which is
    // what the worked example describes: a two-warehouse split, no backorder.
    await planFulfillment(q.id);
  }

  const result = await recomputeQuotation(q.id);
  return { quotationId: q.id, result };
}

beforeAll(async () => {
  acmeId = (await prisma.customer.findUniqueOrThrow({ where: { name: "Acme Industries" } })).id;
  const rep = await prisma.user.findUniqueOrThrow({ where: { email: "priya@dealflow360.test" } });
  repId = rep.id;

  const m = await prisma.user.findUniqueOrThrow({ where: { email: "manager@dealflow360.test" } });
  const f = await prisma.user.findUniqueOrThrow({ where: { email: "finance@dealflow360.test" } });
  manager = { id: m.id, kind: "INTERNAL", role: "SALES_MANAGER", customerId: null, salesTeamId: m.salesTeamId };
  finance = { id: f.id, kind: "INTERNAL", role: "FINANCE_OPS", customerId: null, salesTeamId: null };

  laptopId = (await prisma.product.findUniqueOrThrow({ where: { sku: "HW-LAPTOP-PRO" } })).id;
  setupId = (await prisma.product.findUniqueOrThrow({ where: { sku: "SV-SETUP" } })).id;
  onboardId = (await prisma.product.findUniqueOrThrow({ where: { sku: "SV-ONBOARD" } })).id;
  subscriptionId = (await prisma.product.findUniqueOrThrow({ where: { sku: "SUB-SUPPORT" } })).id;

  // The worked example needs a genuine two-warehouse split. Main normally holds
  // 12 laptops, which would cover the 10-unit line on its own, so it is held at
  // 6 for this file and restored afterwards.
  mainStockId = (
    await prisma.warehouseStock.findFirstOrThrow({
      where: { warehouse: { code: "MAIN" }, productId: laptopId },
    })
  ).id;
  await prisma.warehouseStock.update({
    where: { id: mainStockId },
    data: { availableQuantity: 6 },
  });
});

afterAll(async () => {
  await prisma.quotation.deleteMany({ where: { id: { in: created } } });
  await prisma.warehouseStock.update({
    where: { id: mainStockId },
    data: { availableQuantity: 12, reservedQuantity: 0 },
  });
  await prisma.$disconnect();
});

describe("D10 — ceiling resolution has three levels", () => {
  it("uses the category policy where one exists", async () => {
    const services = await prisma.productCategory.findUniqueOrThrow({ where: { name: "Services" } });
    const r = await resolveDiscountCeiling("GOLD", services.id);

    expect(r.source).toBe("CATEGORY_POLICY");
    expect(r.ceiling.equals(D(10))).toBe(true);
  });

  // Without this level a product in an unpoliced category would have no ceiling
  // at all, and every line in it would pass governance vacuously.
  it("falls back to the tier default where no category policy exists", async () => {
    const subs = await prisma.productCategory.findUniqueOrThrow({ where: { name: "Subscriptions" } });
    const r = await resolveDiscountCeiling("GOLD", subs.id);

    expect(r.source).toBe("TIER_DEFAULT");
    expect(r.ceiling.equals(D(15))).toBe(true);
  });

  it("falls back again when the customer has no tier, and refuses everything", async () => {
    const subs = await prisma.productCategory.findUniqueOrThrow({ where: { name: "Subscriptions" } });
    const r = await resolveDiscountCeiling(null, subs.id);

    expect(r.source).toBe("FALLBACK");
    expect(r.ceiling.equals(D(0))).toBe(true);
  });

  it("gives a Gold customer a higher Services ceiling than a Bronze one", async () => {
    const services = await prisma.productCategory.findUniqueOrThrow({ where: { name: "Services" } });
    const gold = await resolveDiscountCeiling("GOLD", services.id);
    const bronze = await resolveDiscountCeiling("BRONZE", services.id);

    expect(gold.ceiling.greaterThan(bronze.ceiling)).toBe(true);
  });
});

describe("the frozen scenario scores 44 against real data", () => {
  it("computes the documented contributors end to end", async () => {
    const { result } = await acmeScenario({ negotiationRounds: 1, split: true });

    expect(result.marginPercentage.toFixed(1)).toBe("22.0");
    expect(result.riskScore).toBe(44);
    expect(result.riskLevel).toBe("MEDIUM");

    const by = (s: string) => result.riskFactors.find((f) => f.source === s)!;
    expect(by("CATEGORY_VIOLATION").points).toBe(20);
    expect(by("DEVIATION_BREADTH").points).toBe(4);
    expect(by("MARGIN_EXPOSURE").points).toBe(10);
    expect(by("REPEATED_NEGOTIATION").points).toBe(5);
    expect(by("DELIVERY_RISK").points).toBe(5);
  });

  it("persists the breakdown so the approval screen can show it", async () => {
    const { quotationId } = await acmeScenario({ negotiationRounds: 1, split: true });
    const overview = await getApprovalOverview(quotationId);

    expect(overview.riskScore).toBe(44);
    expect(overview.factors).toHaveLength(5);
    const worst = overview.factors.find((f) => f.source === "CATEGORY_VIOLATION")!;
    expect(worst.description).toContain("Setup Service");
    expect(worst.formula).toBe("8.0 over x 2.5 = 20");
  });

  it("writes the resolved ceiling and violation onto each line", async () => {
    const { quotationId } = await acmeScenario();
    const lines = await prisma.quotationLine.findMany({
      where: { quotationId },
      include: { product: { select: { name: true } } },
      orderBy: { sequence: "asc" },
    });

    const laptop = lines.find((l) => l.product.name === "Laptop Pro")!;
    const setup = lines.find((l) => l.product.name === "Setup Service")!;

    expect(laptop.discountCeiling.equals(D(15))).toBe(true);
    expect(laptop.violationPoints.equals(D(0))).toBe(true);
    expect(setup.discountCeiling.equals(D(10))).toBe(true);
    expect(setup.violationPoints.equals(D(8))).toBe(true);
  });

  it("routes to Sales Manager only", async () => {
    const { quotationId } = await acmeScenario({ negotiationRounds: 1, split: true });
    const submitted = await submitForApproval({ quotationId });

    expect(submitted.approvalRequired).toBe(true);
    expect(submitted.approvalState).toBe("PENDING_MANAGER");
    expect(submitted.steps.map((s) => s.approverRole)).toEqual(["SALES_MANAGER"]);
  });
});

describe("the ceiling boundary, through the database", () => {
  async function quoteAt(discount: string) {
    const q = await newQuotation();
    await addQuotationLine({
      quotationId: q.id,
      productId: setupId, // Services, Gold ceiling 10%
      quantity: 1,
      discountPercentage: discount,
    });
    return recomputeQuotation(q.id);
  }

  it("10.00% is at the ceiling and needs no approval", async () => {
    const r = await quoteAt("10.00");
    expect(r.approvalRequired).toBe(false);
  });

  it("10.01% is over it and does", async () => {
    const r = await quoteAt("10.01");
    expect(r.approvalRequired).toBe(true);
    expect(r.approvalReason).toContain("ceiling");
  });

  it("9.99% needs no approval", async () => {
    expect((await quoteAt("9.99")).approvalRequired).toBe(false);
  });
});

describe("the approval state machine", () => {
  async function pendingQuotation() {
    const { quotationId } = await acmeScenario({ negotiationRounds: 1, split: true });
    await submitForApproval({ quotationId });
    const request = await prisma.approvalRequest.findFirstOrThrow({
      where: { quotationId, status: "PENDING" },
    });
    return { quotationId, requestId: request.id };
  }

  it("approving the only step approves the quotation", async () => {
    const { quotationId, requestId } = await pendingQuotation();
    const result = await decideApproval({ requestId, decision: "APPROVE", user: manager });

    expect(result.approvalState).toBe("APPROVED");
    expect(result.nextApprover).toBeNull();

    const saved = await prisma.quotation.findUniqueOrThrow({ where: { id: quotationId } });
    expect(saved.approvalState).toBe("APPROVED");
    expect(saved.approvedAt).not.toBeNull();
  });

  // The named acceptance check: a second approval must never produce a second
  // record. Steps are created once at submission, so a duplicate is
  // structurally impossible; the guard makes the attempt an explicit refusal.
  it("approving twice is refused and creates no duplicate step", async () => {
    const { quotationId, requestId } = await pendingQuotation();
    await decideApproval({ requestId, decision: "APPROVE", user: manager });

    await expect(
      decideApproval({ requestId, decision: "APPROVE", user: manager }),
    ).rejects.toBeInstanceOf(ConflictError);

    const requests = await prisma.approvalRequest.findMany({ where: { quotationId } });
    expect(requests).toHaveLength(1);
    expect(requests[0].status).toBe("APPROVED");
  });

  it("refuses Finance on a manager step", async () => {
    const { requestId } = await pendingQuotation();
    await expect(
      decideApproval({ requestId, decision: "APPROVE", user: finance }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("requires a reason to reject", async () => {
    const { requestId } = await pendingQuotation();
    await expect(
      decideApproval({ requestId, decision: "REJECT", user: manager }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      decideApproval({ requestId, decision: "REJECT", user: manager, reason: "   " }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("records a rejection with its reason", async () => {
    const { requestId } = await pendingQuotation();
    const result = await decideApproval({
      requestId,
      decision: "REJECT",
      user: manager,
      reason: "Service discount is indefensible at this margin",
    });

    expect(result.approvalState).toBe("REJECTED");
    const saved = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(saved.decisionReason).toContain("indefensible");
    expect(saved.decidedById).toBe(manager.id);
  });

  it("refuses a reasonless rejection at the database level too", async () => {
    const { requestId } = await pendingQuotation();
    await expect(
      prisma.$executeRaw`UPDATE "ApprovalRequest" SET status = 'REJECTED' WHERE id = ${requestId}`,
    ).rejects.toThrow(/reason_required/i);
  });

  it("returning for revision allows resubmission without duplicating steps", async () => {
    const { quotationId, requestId } = await pendingQuotation();
    await decideApproval({
      requestId,
      decision: "RETURN",
      user: manager,
      reason: "Please re-check the Setup Service discount",
    });

    let saved = await prisma.quotation.findUniqueOrThrow({ where: { id: quotationId } });
    expect(saved.approvalState).toBe("RETURNED");

    await submitForApproval({ quotationId });
    saved = await prisma.quotation.findUniqueOrThrow({ where: { id: quotationId } });
    expect(saved.approvalState).toBe("PENDING_MANAGER");

    const pending = await prisma.approvalRequest.findMany({
      where: { quotationId, status: "PENDING" },
    });
    expect(pending).toHaveLength(1);
  });

  it("refuses to submit a quotation that is already pending", async () => {
    const { quotationId } = await pendingQuotation();
    await expect(submitForApproval({ quotationId })).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses to submit an empty quotation", async () => {
    const q = await newQuotation();
    await expect(submitForApproval({ quotationId: q.id })).rejects.toBeInstanceOf(ValidationError);
  });

  it("approves outright when nothing triggers review", async () => {
    const q = await newQuotation();
    // Subscriptions has no category policy, so the Gold tier default of 15%
    // applies; 5% is comfortably inside it.
    await addQuotationLine({
      quotationId: q.id,
      productId: subscriptionId,
      quantity: 1,
      discountPercentage: "5.00",
    });
    await recomputeQuotation(q.id);

    const result = await submitForApproval({ quotationId: q.id });
    expect(result.approvalRequired).toBe(false);
    expect(result.approvalState).toBe("APPROVED");
  });
});

describe("escalation to Finance", () => {
  it("adds a Finance step above 60 and keeps the manager first", async () => {
    const q = await newQuotation();
    // Deep discounts on two Services lines plus a wrecked margin push the score
    // past 60 without any hand-set value.
    await addQuotationLine({ quotationId: q.id, productId: setupId, quantity: 1, discountPercentage: "60.00" });
    await addQuotationLine({ quotationId: q.id, productId: onboardId, quantity: 1, discountPercentage: "55.00" });
    const r = await recomputeQuotation(q.id);

    expect(r.riskScore).toBeGreaterThanOrEqual(60);
    expect(r.riskLevel).toBe("HIGH");

    const submitted = await submitForApproval({ quotationId: q.id });
    expect(submitted.steps.map((s) => s.approverRole)).toEqual([
      "SALES_MANAGER",
      "FINANCE_OPS",
    ]);
    expect(submitted.approvalState).toBe("PENDING_MANAGER");

    // Finance is never the first reviewer.
    const managerRequest = await prisma.approvalRequest.findFirstOrThrow({
      where: { quotationId: q.id, status: "PENDING", step: { approverRole: "SALES_MANAGER" } },
    });
    const afterManager = await decideApproval({
      requestId: managerRequest.id,
      decision: "APPROVE",
      user: manager,
    });
    expect(afterManager.approvalState).toBe("PENDING_FINANCE");
    expect(afterManager.nextApprover).toBe("FINANCE_OPS");

    const financeRequest = await prisma.approvalRequest.findFirstOrThrow({
      where: { quotationId: q.id, status: "PENDING" },
    });
    const afterFinance = await decideApproval({
      requestId: financeRequest.id,
      decision: "APPROVE",
      user: finance,
    });
    expect(afterFinance.approvalState).toBe("APPROVED");
  });

  it("refuses a manager on the finance step", async () => {
    const q = await newQuotation();
    await addQuotationLine({ quotationId: q.id, productId: setupId, quantity: 1, discountPercentage: "60.00" });
    await addQuotationLine({ quotationId: q.id, productId: onboardId, quantity: 1, discountPercentage: "55.00" });
    await recomputeQuotation(q.id);
    await submitForApproval({ quotationId: q.id });

    const managerRequest = await prisma.approvalRequest.findFirstOrThrow({
      where: { quotationId: q.id, status: "PENDING", step: { approverRole: "SALES_MANAGER" } },
    });
    await decideApproval({ requestId: managerRequest.id, decision: "APPROVE", user: manager });

    const financeRequest = await prisma.approvalRequest.findFirstOrThrow({
      where: { quotationId: q.id, status: "PENDING" },
    });
    await expect(
      decideApproval({ requestId: financeRequest.id, decision: "APPROVE", user: manager }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("every transition is audited exactly once", () => {
  it("records submission and decision with before and after states", async () => {
    const { quotationId } = await acmeScenario({ negotiationRounds: 1, split: true });
    await submitForApproval({ quotationId });
    const request = await prisma.approvalRequest.findFirstOrThrow({
      where: { quotationId, status: "PENDING" },
    });
    await decideApproval({ requestId: request.id, decision: "APPROVE", user: manager });

    const trail = await auditTrailFor("Quotation", quotationId);
    const approvals = trail.filter((e) => e.action === "APPROVE");
    expect(approvals).toHaveLength(1);
    expect(approvals[0].fieldChanges).toEqual({
      approvalState: { before: "PENDING_MANAGER", after: "APPROVED" },
    });

    const submissions = trail.filter((e) => e.reason?.startsWith("Submitted for approval"));
    expect(submissions).toHaveLength(1);
  });
});

describe("a step cannot be decided twice at once", () => {
  // The status check gives a clear message; the conditional update is the
  // guarantee. Two reviewers pressing Approve together both pass the check.
  it("lets exactly one of two simultaneous approvals through", async () => {
    const { quotationId } = await acmeScenario({ negotiationRounds: 1, split: true });
    await submitForApproval({ quotationId });
    const request = await prisma.approvalRequest.findFirstOrThrow({
      where: { quotationId, status: "PENDING" },
    });

    const results = await Promise.allSettled([
      decideApproval({ requestId: request.id, decision: "APPROVE", user: manager }),
      decideApproval({ requestId: request.id, decision: "APPROVE", user: manager }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

    const requests = await prisma.approvalRequest.findMany({ where: { quotationId } });
    expect(requests).toHaveLength(1);
    expect(requests[0].status).toBe("APPROVED");
  });
});

describe("an approval request never carries a stale score", () => {
  // submitForApproval stamps the request with whatever score the quotation
  // holds at that moment, so anything that changes the score must be persisted
  // before routing. Asserted on the direct path as well as the portal one.
  it("matches the quotation it was raised for", async () => {
    const { quotationId } = await acmeScenario({ negotiationRounds: 1, split: true });
    await submitForApproval({ quotationId });

    const quotation = await prisma.quotation.findUniqueOrThrow({ where: { id: quotationId } });
    const request = await prisma.approvalRequest.findFirstOrThrow({
      where: { quotationId, status: "PENDING" },
    });

    expect(request.riskScore.toFixed(2)).toBe(quotation.riskScore.toFixed(2));
    expect(request.riskScore.toNumber()).toBe(44);
  });
});
