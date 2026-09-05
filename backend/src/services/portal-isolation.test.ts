import { beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, type AuthzUser } from "../authz/roles";
import { prisma } from "../db";
import { getApprovalOverview } from "./approvals";
import { getBillingSchedule } from "./billing";
import { getFulfillmentView } from "./fulfillment";
import { getQuotation, listPortalQuotations, listQuotations } from "./quotations";
import { buildDealContext } from "../ai/context";
import { simulateQuotation } from "./simulation";

/**
 * D20 - what a customer identity may read, in the shape they may read it.
 *
 * These reads were reachable by a portal session because the routes in front of
 * them asked only "may this identity see this row?" and then handed back the
 * internal object. That is a different question from "may they see it in this
 * shape?", and nothing was asking it: a customer reading their own quotation
 * got our unit costs, line margins, risk score and approver chain with it.
 *
 * The capability matrix already had the answer - `PORTAL_VIEW` is `["quotation"]`
 * and margin, riskDetail, billingSchedule and fulfilmentProgress are each their
 * own subject. The services now ask it. These tests are here so a future reader
 * cannot quietly widen the payload back.
 */
describe("portal identities cannot read internal payloads", () => {
  let buyer: AuthzUser;
  let staff: AuthzUser;
  let quotationId: string;

  beforeAll(async () => {
    const portalUser = await prisma.user.findUniqueOrThrow({
      where: { email: "buyer@acme.test" },
    });
    buyer = {
      id: portalUser.id,
      kind: portalUser.kind,
      role: portalUser.role,
      customerId: portalUser.customerId,
      salesTeamId: portalUser.salesTeamId,
    };

    const manager = await prisma.user.findUniqueOrThrow({
      where: { email: "manager@dealflow360.test" },
    });
    // salesTeamId matters: a Sales Manager's row scope is their team (D6), so
    // a fixture without it is not the user getCurrentUser would build, and the
    // manager would be scoped out of their own team's deals.
    staff = {
      id: manager.id,
      kind: manager.kind,
      role: manager.role,
      customerId: null,
      salesTeamId: manager.salesTeamId,
    };

    // Their own quotation, so a refusal below is about the shape of the answer
    // rather than about the row being someone else's.
    const own = await prisma.quotation.findFirstOrThrow({
      where: { customerId: portalUser.customerId! },
      orderBy: { lastActivityAt: "desc" },
    });
    quotationId = own.id;
  });

  it("refuses the internal quotation list, which carries margin and risk", async () => {
    await expect(listQuotations(buyer)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a full quotation, which carries unit costs and line margins", async () => {
    await expect(getQuotation(buyer, quotationId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses the approval overview, which carries the risk breakdown", async () => {
    await expect(getApprovalOverview(buyer, quotationId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses the billing schedule, which carries the invoice ledger", async () => {
    await expect(getBillingSchedule(buyer, quotationId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses the fulfilment view, which carries our sourcing plan", async () => {
    await expect(getFulfillmentView(buyer, quotationId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("still lets staff read every one of them", async () => {
    await expect(listQuotations(staff)).resolves.toBeInstanceOf(Array);
    await expect(getQuotation(staff, quotationId)).resolves.toBeTruthy();
    await expect(getApprovalOverview(staff, quotationId)).resolves.toBeTruthy();
    await expect(getBillingSchedule(staff, quotationId)).resolves.toBeTruthy();
    await expect(getFulfillmentView(staff, quotationId)).resolves.toBeTruthy();
  });

  it("gives the portal its own list, whitelisted rather than filtered", async () => {
    const rows = await listPortalQuotations(buyer);
    expect(rows.length).toBeGreaterThan(0);

    // A whitelist, so this asserts the whole key set rather than the absence of
    // the fields we happen to remember today.
    expect(Object.keys(rows[0]).sort()).toEqual([
      "id",
      "portalStatus",
      "quoteNumber",
      "status",
      "totalAmount",
      "validUntil",
    ]);
  });

  it("scopes that list to the customer's own quotations", async () => {
    const rows = await listPortalQuotations(buyer);
    const ids = rows.map((row) => row.id);
    const foreign = await prisma.quotation.count({
      where: { id: { in: ids }, customerId: { not: buyer.customerId! } },
    });
    expect(foreign).toBe(0);
  });
});

/**
 * Row scope, as distinct from capability.
 *
 * A SALES_REP holds the "margin" capability - for their own deals. Asking only
 * the capability let one rep read another rep's quotation in full, which is how
 * the AI context builder came to leak: it called `getQuotation` and never asked
 * the second question. The scope check now lives inside the service, and this
 * is here so it stays there.
 */
describe("a rep cannot read another rep's deal", () => {
  let rahul: AuthzUser;
  let foreignQuotationId: string;

  beforeAll(async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "rahul@dealflow360.test" } });
    rahul = {
      id: user.id,
      kind: user.kind,
      role: user.role,
      customerId: user.customerId,
      salesTeamId: user.salesTeamId,
    };

    // A deal owned by someone else entirely.
    const other = await prisma.quotation.findFirstOrThrow({
      where: { salesRepId: { not: user.id } },
      orderBy: { lastActivityAt: "desc" },
    });
    foreignQuotationId = other.id;
  });

  it("is refused by getQuotation itself, not merely by the route in front of it", async () => {
    // NotFound rather than Forbidden on purpose: telling an unauthorised caller
    // that a record exists is itself a disclosure.
    await expect(getQuotation(rahul, foreignQuotationId)).rejects.toMatchObject({ status: 404 });
  });

  it("keeps its own deals readable", async () => {
    const mine = await listQuotations(rahul);
    expect(mine.length).toBeGreaterThan(0);
    await expect(getQuotation(rahul, mine[0].id)).resolves.toBeTruthy();
  });

  it("cannot build an AI deal context for it either", async () => {
    await expect(buildDealContext(rahul, foreignQuotationId)).rejects.toMatchObject({ status: 404 });
  });

  it("cannot simulate scenarios on it", async () => {
    await expect(
      simulateQuotation(rahul, foreignQuotationId, [{ kind: "setAllDiscounts", discountPercentage: "5" }]),
    ).rejects.toMatchObject({ status: 404 });
  });
});
