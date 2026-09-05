import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "../generated/prisma/client";
import { auditTrailFor } from "../audit";
import type { AuthzUser } from "../authz/roles";
import { prisma } from "../db";
import { submitForApproval } from "./approvals";
import {
  assertNoInternalFields,
  confirmPortalQuotation,
  getNegotiationHistory,
  shareWithCustomer,
  submitNegotiation,
  viewPortalQuotation,
} from "./portal";
import { lastApprovedSnapshot, versionHistory } from "./quotation-versions";
import { addQuotationLine, createQuotation, recomputeQuotation } from "./quotations";

const D = (v: string | number) => new Prisma.Decimal(v);

let acmeId: string;
let repId: string;
let setupId: string;
let laptopId: string;
let acmeBuyer: AuthzUser;
let betaBuyer: AuthzUser;
let internalRep: AuthzUser;
const created: string[] = [];

/**
 * A quotation approved at 10% on its Service line - exactly at the Gold
 * ceiling, so it approves without a reviewer and leaves a clean snapshot for
 * the negotiation to be judged against.
 */
async function approvedAtTenPercent() {
  const q = await createQuotation({ customerId: acmeId, salesRepId: repId });
  created.push(q.id);
  await addQuotationLine({ quotationId: q.id, productId: laptopId, quantity: 2, discountPercentage: "0" });
  const line = await addQuotationLine({
    quotationId: q.id,
    productId: setupId,
    quantity: 1,
    discountPercentage: "10.00",
  });
  await recomputeQuotation(q.id);
  await submitForApproval({ quotationId: q.id });
  await shareWithCustomer({ quotationId: q.id });
  return { quotationId: q.id, serviceLineId: line.id };
}

beforeAll(async () => {
  acmeId = (await prisma.customer.findUniqueOrThrow({ where: { name: "Acme Industries" } })).id;
  repId = (await prisma.user.findUniqueOrThrow({ where: { email: "priya@dealflow360.test" } })).id;
  setupId = (await prisma.product.findUniqueOrThrow({ where: { sku: "SV-SETUP" } })).id;
  laptopId = (await prisma.product.findUniqueOrThrow({ where: { sku: "HW-LAPTOP-PRO" } })).id;

  const acmeUser = await prisma.user.findUniqueOrThrow({ where: { email: "buyer@acme.test" } });
  const betaUser = await prisma.user.findUniqueOrThrow({ where: { email: "buyer@beta.test" } });
  acmeBuyer = { id: acmeUser.id, kind: "PORTAL", role: null, customerId: acmeUser.customerId, salesTeamId: null };
  betaBuyer = { id: betaUser.id, kind: "PORTAL", role: null, customerId: betaUser.customerId, salesTeamId: null };
  internalRep = { id: repId, kind: "INTERNAL", role: "SALES_REP", customerId: null, salesTeamId: null };
});

afterAll(async () => {
  await prisma.quotation.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

describe("the frozen scenario: approved at 10%, customer asks for 15%", () => {
  it("resets approval to pending manager and marks the request accordingly", async () => {
    const { quotationId, serviceLineId } = await approvedAtTenPercent();

    const before = await prisma.quotation.findUniqueOrThrow({ where: { id: quotationId } });
    expect(before.approvalState).toBe("APPROVED");

    const result = await submitNegotiation({
      user: acmeBuyer,
      quotationId,
      requestType: "COUNTER_DISCOUNT",
      lineId: serviceLineId,
      requestedValue: "15.00",
      reason: "Budget is tight this quarter",
    });

    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    expect(result.outcome).toBe("ACCEPTED_PENDING_APPROVAL");

    const after = await prisma.quotation.findUniqueOrThrow({ where: { id: quotationId } });
    expect(after.approvalState).toBe("PENDING_MANAGER");

    const request = await prisma.negotiationRequest.findUniqueOrThrow({
      where: { id: result.requestId },
    });
    expect(request.status).toBe("ACCEPTED_PENDING_APPROVAL");
  });

  it("applies the requested discount to the live quotation", async () => {
    const { quotationId, serviceLineId } = await approvedAtTenPercent();
    await submitNegotiation({
      user: acmeBuyer,
      quotationId,
      requestType: "COUNTER_DISCOUNT",
      lineId: serviceLineId,
      requestedValue: "15.00",
    });

    const line = await prisma.quotationLine.findUniqueOrThrow({ where: { id: serviceLineId } });
    expect(line.discountPercentage.equals(D(15))).toBe(true);
    // 15% against a 10% Gold Services ceiling is 5 points over.
    expect(line.violationPoints.equals(D(5))).toBe(true);
  });

  it("puts the same quote back in front of a manager", async () => {
    const { quotationId, serviceLineId } = await approvedAtTenPercent();
    await submitNegotiation({
      user: acmeBuyer,
      quotationId,
      requestType: "COUNTER_DISCOUNT",
      lineId: serviceLineId,
      requestedValue: "15.00",
    });

    const pending = await prisma.approvalRequest.findMany({
      where: { quotationId, status: "PENDING" },
      include: { step: true },
    });
    expect(pending).toHaveLength(1);
    expect(pending[0].step.approverRole).toBe("SALES_MANAGER");
  });

  it("explains why, against the approved snapshot rather than the live quote", async () => {
    const { quotationId, serviceLineId } = await approvedAtTenPercent();
    const result = await submitNegotiation({
      user: acmeBuyer,
      quotationId,
      requestType: "COUNTER_DISCOUNT",
      lineId: serviceLineId,
      requestedValue: "15.00",
    });

    if (result.status !== 200 || !result.whatIf) throw new Error("expected a what-if");
    expect(result.whatIf.requiresReapproval).toBe(true);
    expect(result.whatIf.worsenedLines).toHaveLength(1);
    expect(result.whatIf.worsenedLines[0]).toMatchObject({
      approvedDiscount: "10.00",
      proposedDiscount: "15.00",
      approvedExcess: "0.00",
      proposedExcess: "5.00",
    });
  });

  it("counts the round, which itself feeds the risk score", async () => {
    const { quotationId, serviceLineId } = await approvedAtTenPercent();
    await submitNegotiation({
      user: acmeBuyer,
      quotationId,
      requestType: "COUNTER_DISCOUNT",
      lineId: serviceLineId,
      requestedValue: "15.00",
    });

    const quotation = await prisma.quotation.findUniqueOrThrow({ where: { id: quotationId } });
    expect(quotation.negotiationCount).toBe(1);

    const factors = await prisma.riskFactor.findMany({ where: { quotationId } });
    expect(factors.find((f) => f.source === "REPEATED_NEGOTIATION")!.points.equals(D(5))).toBe(true);
  });
});

describe("a smaller ask needs no new approval", () => {
  it("applies immediately and leaves the approval state alone", async () => {
    const { quotationId, serviceLineId } = await approvedAtTenPercent();

    const result = await submitNegotiation({
      user: acmeBuyer,
      quotationId,
      requestType: "COUNTER_DISCOUNT",
      lineId: serviceLineId,
      requestedValue: "8.00",
    });

    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    expect(result.outcome).toBe("ACCEPTED_NO_REAPPROVAL");

    const after = await prisma.quotation.findUniqueOrThrow({ where: { id: quotationId } });
    expect(after.approvalState).toBe("APPROVED");

    const pending = await prisma.approvalRequest.count({
      where: { quotationId, status: "PENDING" },
    });
    expect(pending).toBe(0);
  });

  it("still applies the new terms", async () => {
    const { quotationId, serviceLineId } = await approvedAtTenPercent();
    await submitNegotiation({
      user: acmeBuyer,
      quotationId,
      requestType: "COUNTER_DISCOUNT",
      lineId: serviceLineId,
      requestedValue: "8.00",
    });

    const line = await prisma.quotationLine.findUniqueOrThrow({ where: { id: serviceLineId } });
    expect(line.discountPercentage.equals(D(8))).toBe(true);
  });
});

/** 05_SECURITY.md asks for 403 by name: an empty page would read as "hidden". */
describe("cross-customer isolation", () => {
  it("refuses another customer with 403, not an empty page", async () => {
    const { quotationId } = await approvedAtTenPercent();

    expect((await viewPortalQuotation(betaBuyer, quotationId)).status).toBe(403);
  });

  it("refuses their negotiation attempt too", async () => {
    const { quotationId, serviceLineId } = await approvedAtTenPercent();

    const result = await submitNegotiation({
      user: betaBuyer,
      quotationId,
      requestType: "COUNTER_DISCOUNT",
      lineId: serviceLineId,
      requestedValue: "15.00",
    });
    expect(result.status).toBe(403);
  });

  it("refuses their confirmation attempt", async () => {
    const { quotationId } = await approvedAtTenPercent();
    expect((await confirmPortalQuotation({ user: betaBuyer, quotationId })).status).toBe(403);
  });

  it("lets the owning customer through", async () => {
    const { quotationId } = await approvedAtTenPercent();
    expect((await viewPortalQuotation(acmeBuyer, quotationId)).status).toBe(200);
  });

  it("refuses an unauthenticated caller with 401", async () => {
    const { quotationId } = await approvedAtTenPercent();
    expect((await viewPortalQuotation(null, quotationId)).status).toBe(401);
  });

  // The portal is a different surface, not a narrower internal one.
  it("refuses an internal user on the portal route", async () => {
    const { quotationId } = await approvedAtTenPercent();
    expect((await viewPortalQuotation(internalRep, quotationId)).status).toBe(403);
  });

  it("hides a quotation the seller has not shared", async () => {
    const q = await createQuotation({ customerId: acmeId, salesRepId: repId });
    created.push(q.id);
    await addQuotationLine({ quotationId: q.id, productId: setupId, quantity: 1 });

    expect((await viewPortalQuotation(acmeBuyer, q.id)).status).toBe(404);
  });
});

describe("confirming", () => {
  it("succeeds while the quote is approved", async () => {
    const { quotationId } = await approvedAtTenPercent();

    const result = await confirmPortalQuotation({ user: acmeBuyer, quotationId });
    expect(result.status).toBe(200);

    const saved = await prisma.quotation.findUniqueOrThrow({ where: { id: quotationId } });
    expect(saved.status).toBe("CONFIRMED");
    expect(saved.portalStatus).toBe("CONFIRMED");
  });

  // The gap between loading the page and clicking Confirm is exactly where a
  // re-approval lands.
  it("returns 409 rather than a false success once a negotiation reset approval", async () => {
    const { quotationId, serviceLineId } = await approvedAtTenPercent();
    await submitNegotiation({
      user: acmeBuyer,
      quotationId,
      requestType: "COUNTER_DISCOUNT",
      lineId: serviceLineId,
      requestedValue: "15.00",
    });

    const result = await confirmPortalQuotation({ user: acmeBuyer, quotationId });

    expect(result.status).toBe(409);
    if (result.status !== 409) return;
    expect(result.reason).toBe("pending_approval");
    expect(result.message).toContain("reviewed by the seller");

    const saved = await prisma.quotation.findUniqueOrThrow({ where: { id: quotationId } });
    expect(saved.status).not.toBe("CONFIRMED");
  });

  it("returns 409 on a second confirmation", async () => {
    const { quotationId } = await approvedAtTenPercent();
    await confirmPortalQuotation({ user: acmeBuyer, quotationId });

    const again = await confirmPortalQuotation({ user: acmeBuyer, quotationId });
    expect(again.status).toBe(409);
    if (again.status === 409) expect(again.reason).toBe("already_confirmed");
  });

  it("closes the negotiation thread", async () => {
    const { quotationId, serviceLineId } = await approvedAtTenPercent();
    await submitNegotiation({
      user: acmeBuyer,
      quotationId,
      requestType: "QUESTION",
      lineId: serviceLineId,
      reason: "Does this include installation?",
    });
    await confirmPortalQuotation({ user: acmeBuyer, quotationId });

    const negotiations = await getNegotiationHistory(quotationId);
    expect(negotiations.every((n) => n.status === "CLOSED")).toBe(true);
  });
});

/**
 * D20 - the customer sees a different surface, not a narrower internal one.
 */
describe("the portal payload leaks nothing internal", () => {
  it("contains no cost, margin, risk or approval field", async () => {
    const { quotationId } = await approvedAtTenPercent();
    const result = await viewPortalQuotation(acmeBuyer, quotationId);

    expect(result.status).toBe(200);
    if (result.status !== 200) return;

    // Throws naming the offending field if anything internal appears.
    expect(() => assertNoInternalFields(result.quotation)).not.toThrow();

    const serialised = JSON.stringify(result.quotation);
    for (const leak of ["riskScore", "approvalState", "unitCost", "marginPercentage", "discountCeiling"]) {
      expect(serialised).not.toContain(leak);
    }
  });

  it("shows the customer vocabulary, never the internal state machine", async () => {
    const { quotationId, serviceLineId } = await approvedAtTenPercent();

    let view = await viewPortalQuotation(acmeBuyer, quotationId);
    expect(view.status === 200 && view.quotation.status).toBe("Sent");

    await submitNegotiation({
      user: acmeBuyer,
      quotationId,
      requestType: "COUNTER_DISCOUNT",
      lineId: serviceLineId,
      requestedValue: "15.00",
    });

    view = await viewPortalQuotation(acmeBuyer, quotationId);
    // Internally this is PENDING_MANAGER; the customer is told only this.
    expect(view.status === 200 && view.quotation.status).toBe("Under Negotiation");
    expect(view.status === 200 && view.quotation.awaitingSellerReview).toBe(true);
  });

  it("says Confirmed once confirmed", async () => {
    const { quotationId } = await approvedAtTenPercent();
    await confirmPortalQuotation({ user: acmeBuyer, quotationId });

    const view = await viewPortalQuotation(acmeBuyer, quotationId);
    expect(view.status === 200 && view.quotation.status).toBe("Confirmed");
  });

  it("shows the customer their own thread", async () => {
    const { quotationId, serviceLineId } = await approvedAtTenPercent();
    await submitNegotiation({
      user: acmeBuyer,
      quotationId,
      requestType: "QUESTION",
      lineId: serviceLineId,
      reason: "Can delivery be split?",
    });

    const view = await viewPortalQuotation(acmeBuyer, quotationId);
    if (view.status !== 200) throw new Error("expected 200");
    expect(view.quotation.conversation.comments[0].message).toBe("Can delivery be split?");
  });
});

/** D5 - the snapshot is a real version row, not a JSON blob kept in step by hand. */
describe("quotation versions", () => {
  it("records an approved version when a quotation is approved", async () => {
    const { quotationId } = await approvedAtTenPercent();

    const snapshot = await lastApprovedSnapshot(quotationId);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.approvedAt).toBeInstanceOf(Date);

    const serviceTerms = snapshot!.lines.find((l) => l.label === "Setup Service")!;
    expect(new Prisma.Decimal(serviceTerms.discountPercentage).equals(D(10))).toBe(true);
  });

  it("adds a version for the negotiation without marking it approved", async () => {
    const { quotationId, serviceLineId } = await approvedAtTenPercent();
    await submitNegotiation({
      user: acmeBuyer,
      quotationId,
      requestType: "COUNTER_DISCOUNT",
      lineId: serviceLineId,
      requestedValue: "15.00",
    });

    const history = await versionHistory(quotationId);
    expect(history.length).toBeGreaterThanOrEqual(2);

    // The approved snapshot is still the 10% one: the negotiation has not been
    // signed off, so it must not become the baseline for the next comparison.
    const snapshot = await lastApprovedSnapshot(quotationId);
    const serviceTerms = snapshot!.lines.find((l) => l.label === "Setup Service")!;
    expect(new Prisma.Decimal(serviceTerms.discountPercentage).equals(D(10))).toBe(true);
  });
});

describe("validation and non-commercial requests", () => {
  it("rejects a counter-discount with no line or no value", async () => {
    const { quotationId, serviceLineId } = await approvedAtTenPercent();

    expect(
      (await submitNegotiation({
        user: acmeBuyer,
        quotationId,
        requestType: "COUNTER_DISCOUNT",
        lineId: serviceLineId,
      })).status,
    ).toBe(422);

    expect(
      (await submitNegotiation({
        user: acmeBuyer,
        quotationId,
        requestType: "COUNTER_DISCOUNT",
        requestedValue: "12.00",
      })).status,
    ).toBe(422);
  });

  it("rejects an impossible percentage", async () => {
    const { quotationId, serviceLineId } = await approvedAtTenPercent();
    expect(
      (await submitNegotiation({
        user: acmeBuyer,
        quotationId,
        requestType: "COUNTER_DISCOUNT",
        lineId: serviceLineId,
        requestedValue: "150",
      })).status,
    ).toBe(422);
  });

  // A question changes no commercial term, so nothing is re-evaluated.
  it("leaves approval untouched for a question", async () => {
    const { quotationId, serviceLineId } = await approvedAtTenPercent();

    const result = await submitNegotiation({
      user: acmeBuyer,
      quotationId,
      requestType: "QUESTION",
      lineId: serviceLineId,
      reason: "Is onsite support included?",
    });

    expect(result.status === 200 && result.outcome).toBe("SUBMITTED");
    const saved = await prisma.quotation.findUniqueOrThrow({ where: { id: quotationId } });
    expect(saved.approvalState).toBe("APPROVED");
    expect(saved.negotiationCount).toBe(0);
  });
});

describe("every negotiation is audited", () => {
  it("records the outcome and what moved", async () => {
    const { quotationId, serviceLineId } = await approvedAtTenPercent();
    await submitNegotiation({
      user: acmeBuyer,
      quotationId,
      requestType: "COUNTER_DISCOUNT",
      lineId: serviceLineId,
      requestedValue: "15.00",
    });

    const trail = await auditTrailFor("Quotation", quotationId);
    const negotiation = trail.find((e) => e.action === "NEGOTIATE")!;
    const changes = negotiation.fieldChanges as Record<string, unknown>;

    expect(changes.outcome).toBe("ACCEPTED_PENDING_APPROVAL");
    expect(changes.requestedDiscount).toBe("15.00");
    expect(Array.isArray(changes.worsenedLines)).toBe(true);
  });
});

describe("the approval request agrees with the quotation it belongs to", () => {
  // A reviewer opening the approval screen must not see a request stamped with
  // one score while the quote it points at reads another.
  it("stamps the request with the score the quotation actually carries", async () => {
    const { quotationId, serviceLineId } = await approvedAtTenPercent();
    await submitNegotiation({
      user: acmeBuyer,
      quotationId,
      requestType: "COUNTER_DISCOUNT",
      lineId: serviceLineId,
      requestedValue: "15.00",
    });

    const quotation = await prisma.quotation.findUniqueOrThrow({ where: { id: quotationId } });
    const request = await prisma.approvalRequest.findFirstOrThrow({
      where: { quotationId, status: "PENDING" },
    });

    expect(request.riskScore.toFixed(2)).toBe(quotation.riskScore.toFixed(2));
  });
});
