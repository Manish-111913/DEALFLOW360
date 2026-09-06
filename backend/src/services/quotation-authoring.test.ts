import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthzUser } from "../authz/roles";
import { ForbiddenError } from "../authz/roles";
import { prisma } from "../db";
import {
  addLineAs,
  createQuotationAs,
  removeLineAs,
  shareWithCustomerAs,
  submitForApprovalAs,
  updateLineAs,
} from "./quotation-authoring";

/**
 * Authoring a quotation, with the caller checked.
 *
 * This layer exists because the primitives in `quotations.ts` take no user at
 * all - they are what seeds and tests compose - so for a long time there was no
 * authorised way to create a quotation and the product simply had no button for
 * it. These tests are what stop that layer quietly losing its checks.
 */

let priya: AuthzUser;
let rahul: AuthzUser;
let manager: AuthzUser;
let buyer: AuthzUser;
let acmeId: string;
let laptopId: string;
let setupId: string;

const created: string[] = [];

async function userFor(email: string): Promise<AuthzUser> {
  const f = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { id: f.id, kind: f.kind, role: f.role, customerId: f.customerId, salesTeamId: f.salesTeamId };
}

async function draftFor(user: AuthzUser) {
  const q = await createQuotationAs(user, { customerId: acmeId });
  created.push(q.id);
  return q;
}

beforeAll(async () => {
  priya = await userFor("priya@dealflow360.test");
  rahul = await userFor("rahul@dealflow360.test");
  manager = await userFor("manager@dealflow360.test");
  buyer = await userFor("buyer@acme.test");

  acmeId = (await prisma.customer.findFirstOrThrow({ where: { name: "Acme Industries" } })).id;
  laptopId = (await prisma.product.findFirstOrThrow({ where: { sku: "HW-LAPTOP-PRO" } })).id;
  setupId = (await prisma.product.findFirstOrThrow({ where: { sku: "SV-SETUP" } })).id;
});

afterAll(async () => {
  await prisma.quotation.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

describe("who may create a quotation", () => {
  it("gives the creating rep ownership", async () => {
    const q = await draftFor(priya);
    expect(q.salesRepId).toBe(priya.id);
    expect(q.status).toBe("DRAFT");
  });

  it("refuses to let a rep put someone else's name on it", async () => {
    // Not an error: the request is honoured minus the part they may not do,
    // because a rep quietly owning what they create is the expected outcome.
    const q = await createQuotationAs(priya, { customerId: acmeId, salesRepId: rahul.id });
    created.push(q.id);
    expect(q.salesRepId).toBe(priya.id);
  });

  it("lets a manager assign the owner", async () => {
    const q = await createQuotationAs(manager, { customerId: acmeId, salesRepId: rahul.id });
    created.push(q.id);
    expect(q.salesRepId).toBe(rahul.id);
  });

  it("refuses a portal identity outright", async () => {
    await expect(createQuotationAs(buyer, { customerId: acmeId })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("editing lines", () => {
  it("recomputes the deal on every change", async () => {
    const q = await draftFor(priya);

    await addLineAs(priya, { quotationId: q.id, productId: laptopId, quantity: 10, discountPercentage: "12.00" });
    const afterFirst = await prisma.quotation.findUniqueOrThrow({ where: { id: q.id } });

    // A line over its category ceiling should move the risk score, which is
    // the whole point of recomputing rather than just summing.
    await addLineAs(priya, { quotationId: q.id, productId: setupId, quantity: 1, discountPercentage: "18.00" });
    const afterSecond = await prisma.quotation.findUniqueOrThrow({ where: { id: q.id } });

    expect(afterSecond.totalAmount.greaterThan(afterFirst.totalAmount)).toBe(true);
    expect(Number(afterSecond.riskScore)).toBeGreaterThan(Number(afterFirst.riskScore));
  });

  it("updates and removes", async () => {
    const q = await draftFor(priya);
    const line = await addLineAs(priya, {
      quotationId: q.id, productId: laptopId, quantity: 4, discountPercentage: "5.00",
    });

    await updateLineAs(priya, line.id, { quantity: 9 });
    expect(
      (await prisma.quotationLine.findUniqueOrThrow({ where: { id: line.id } })).quantity,
    ).toBe(9);

    await removeLineAs(priya, line.id);
    expect(await prisma.quotationLine.count({ where: { quotationId: q.id } })).toBe(0);
  });

  it("refuses a quantity below one", async () => {
    const q = await draftFor(priya);
    await expect(
      addLineAs(priya, { quotationId: q.id, productId: laptopId, quantity: 0 }),
    ).rejects.toThrow();
  });
});

describe("another rep's deal is not editable", () => {
  it("refuses every authoring action", async () => {
    const q = await draftFor(priya);
    const line = await addLineAs(priya, { quotationId: q.id, productId: laptopId, quantity: 2 });

    // NotFound rather than Forbidden, for the same reason as everywhere else:
    // confirming a record exists is itself a disclosure.
    await expect(
      addLineAs(rahul, { quotationId: q.id, productId: laptopId, quantity: 1 }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(updateLineAs(rahul, line.id, { quantity: 5 })).rejects.toMatchObject({ status: 404 });
    await expect(removeLineAs(rahul, line.id)).rejects.toMatchObject({ status: 404 });
    await expect(shareWithCustomerAs(rahul, q.id)).rejects.toMatchObject({ status: 404 });
    await expect(submitForApprovalAs(rahul, q.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("a quotation stops being editable once it leaves the rep", () => {
  it("refuses edits while it is awaiting approval", async () => {
    const q = await draftFor(priya);
    await addLineAs(priya, { quotationId: q.id, productId: laptopId, quantity: 10, discountPercentage: "12.00" });
    // Over its ceiling, so routing will genuinely require a reviewer.
    await addLineAs(priya, { quotationId: q.id, productId: setupId, quantity: 1, discountPercentage: "30.00" });

    const routed = await submitForApprovalAs(priya, q.id);
    expect(routed.approvalRequired).toBe(true);

    await expect(
      addLineAs(priya, { quotationId: q.id, productId: laptopId, quantity: 1 }),
    ).rejects.toThrow(/awaiting approval/i);
  });
});

describe("sharing with the customer", () => {
  it("makes the quotation visible in the portal", async () => {
    const q = await draftFor(priya);
    await addLineAs(priya, { quotationId: q.id, productId: laptopId, quantity: 3 });

    await shareWithCustomerAs(priya, q.id);
    const shared = await prisma.quotation.findUniqueOrThrow({ where: { id: q.id } });
    expect(shared.portalStatus).not.toBe("NOT_SHARED");
  });

  it("refuses to share an empty quotation", async () => {
    const q = await draftFor(priya);
    await expect(shareWithCustomerAs(priya, q.id)).rejects.toThrow(/empty/i);
  });
});
