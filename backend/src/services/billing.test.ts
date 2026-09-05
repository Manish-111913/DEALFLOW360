import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "../generated/prisma/client";
import { auditTrailFor } from "../audit";
import { ForbiddenError, type AuthzUser } from "../authz/roles";
import { advanceClock, currentBusinessTime, resetClock } from "../clock";
import { prisma } from "../db";
import { ConflictError, ValidationError } from "../errors";
import {
  cancelSubscription,
  changeSubscriptionQuantity,
  createSubscriptionsForOrder,
  getBillingSchedule,
  invoiceOneTimeLines,
  recordPayment,
  runBilling,
} from "./billing";
import { addQuotationLine, createQuotation } from "./quotations";

const D = (v: string | number) => new Prisma.Decimal(v);

/** September 2026 has 30 days, which is what the worked example assumes. */
const SEP = (day: number) => new Date(Date.UTC(2026, 8, day, 9, 0, 0));
const OCT = (day: number) => new Date(Date.UTC(2026, 9, day, 9, 0, 0));

let acmeId: string;
let repId: string;
let supportId: string;
let laptopId: string;
let finance: AuthzUser;
let rep: AuthzUser;
const created: string[] = [];

/**
 * Move the business clock to a specific date.
 *
 * The frozen example depends on the calendar - a 30-day month, a start on the
 * 15th - so the test sets the date rather than hoping the suite runs on the
 * right day. This is the same control the demo uses (D3).
 */
async function travelTo(target: Date) {
  const now = currentBusinessTime();
  await advanceClock({ ms: target.getTime() - now.getTime() }, "test");
}

/** An order carrying a recurring Support Subscription line. */
async function recurringOrder(options?: { withOneTimeLine?: boolean }) {
  const q = await createQuotation({ customerId: acmeId, salesRepId: repId });
  created.push(q.id);

  if (options?.withOneTimeLine) {
    await addQuotationLine({
      quotationId: q.id,
      productId: laptopId,
      quantity: 2,
      discountPercentage: "0",
    });
  }
  await addQuotationLine({ quotationId: q.id, productId: supportId, quantity: 1 });
  return q.id;
}

beforeAll(async () => {
  acmeId = (await prisma.customer.findUniqueOrThrow({ where: { name: "Acme Industries" } })).id;
  const r = await prisma.user.findUniqueOrThrow({ where: { email: "priya@dealflow360.test" } });
  const f = await prisma.user.findUniqueOrThrow({ where: { email: "finance@dealflow360.test" } });
  repId = r.id;
  rep = { id: r.id, kind: "INTERNAL", role: "SALES_REP", customerId: null, salesTeamId: r.salesTeamId };
  finance = { id: f.id, kind: "INTERNAL", role: "FINANCE_OPS", customerId: null, salesTeamId: null };

  supportId = (await prisma.product.findUniqueOrThrow({ where: { sku: "SUB-SUPPORT" } })).id;
  laptopId = (await prisma.product.findUniqueOrThrow({ where: { sku: "HW-LAPTOP-PRO" } })).id;
});

afterEach(async () => {
  await resetClock("test");
});

afterAll(async () => {
  await resetClock("test");

  // Invoices deliberately block deletion of the quotation they bill: a
  // financial document should not vanish because someone tidied a quote. Test
  // cleanup therefore unwinds in the same order production would have to.
  await prisma.creditNote.deleteMany({
    where: { subscription: { quotationId: { in: created } } },
  });
  await prisma.billingSchedule.deleteMany({
    where: { subscription: { quotationId: { in: created } } },
  });
  await prisma.invoice.deleteMany({ where: { quotationId: { in: created } } });
  await prisma.quotation.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

describe("the frozen scenario: 12,000 a month starting on the 15th", () => {
  it("charges 6,400.00 for the first cycle and 12,000.00 thereafter", async () => {
    await travelTo(SEP(15));
    const quotationId = await recurringOrder();
    await createSubscriptionsForOrder({ quotationId });

    const view = await getBillingSchedule(quotationId);
    const upcoming = view.recurring[0].upcoming;

    expect(upcoming[0].amount.equals(D("6400"))).toBe(true);
    expect(upcoming[1].amount.equals(D("12000"))).toBe(true);
    expect(upcoming[2].amount.equals(D("12000"))).toBe(true);
  });

  it("explains the partial first period on the schedule itself", async () => {
    await travelTo(SEP(15));
    const quotationId = await recurringOrder();
    await createSubscriptionsForOrder({ quotationId });

    const view = await getBillingSchedule(quotationId);
    expect(view.recurring[0].upcoming[0].prorationNote).toContain("16 of 30 days");
    expect(view.recurring[0].upcoming[1].prorationNote).toBeNull();
  });

  it("bills on the first of each period", async () => {
    await travelTo(SEP(15));
    const quotationId = await recurringOrder();
    await createSubscriptionsForOrder({ quotationId });

    const view = await getBillingSchedule(quotationId);
    const dates = view.recurring[0].upcoming
      .slice(0, 3)
      .map((u) => u.billingDate.toISOString().slice(0, 10));

    expect(dates).toEqual(["2026-09-01", "2026-10-01", "2026-11-01"]);
  });

  it("does not create a second subscription if the order is confirmed again", async () => {
    await travelTo(SEP(15));
    const quotationId = await recurringOrder();

    expect((await createSubscriptionsForOrder({ quotationId })).created).toBe(1);
    expect((await createSubscriptionsForOrder({ quotationId })).created).toBe(0);
  });
});

/**
 * The whole reason the application clock exists: a recurring invoice is
 * something a judge can watch appear, rather than something described.
 */
describe("running billing as time passes", () => {
  it("raises the prorated first invoice, then the full one next month", async () => {
    await travelTo(SEP(15));
    const quotationId = await recurringOrder();
    await createSubscriptionsForOrder({ quotationId });

    // runBilling is a whole-system run, so its own counts include any other
    // subscription that happens to be due. Assert on this order instead.
    await runBilling({ asOf: currentBusinessTime() });

    let invoices = await prisma.invoice.findMany({
      where: { quotationId, invoiceType: "RECURRING" },
      orderBy: { issueDate: "asc" },
    });
    expect(invoices).toHaveLength(1);
    expect(invoices[0].total.equals(D("6400"))).toBe(true);

    // Move the clock into October and run again.
    await travelTo(OCT(1));
    await runBilling({ asOf: currentBusinessTime() });

    invoices = await prisma.invoice.findMany({
      where: { quotationId, invoiceType: "RECURRING" },
      orderBy: { issueDate: "asc" },
    });
    expect(invoices).toHaveLength(2);
    expect(invoices[1].total.equals(D("12000"))).toBe(true);
  });

  // Exposed as a demo button as well as a timer, so a second press must be safe.
  it("is idempotent for the same date", async () => {
    await travelTo(SEP(15));
    const quotationId = await recurringOrder();
    await createSubscriptionsForOrder({ quotationId });

    await runBilling({ asOf: currentBusinessTime() });
    await runBilling({ asOf: currentBusinessTime() });

    const invoices = await prisma.invoice.findMany({
      where: { quotationId, invoiceType: "RECURRING" },
    });
    expect(invoices).toHaveLength(1);
  });

  it("does not bill a period that has not come due", async () => {
    await travelTo(SEP(15));
    const quotationId = await recurringOrder();
    await createSubscriptionsForOrder({ quotationId });
    await runBilling({ asOf: currentBusinessTime() });

    const scheduled = await prisma.billingSchedule.count({
      where: { subscription: { quotationId }, status: "SCHEDULED" },
    });
    expect(scheduled).toBeGreaterThan(0);
  });
});

/**
 * §B7: one-time and recurring lines live on the same order and bill separately.
 */
describe("a one-time line bills independently of the subscription", () => {
  it("invoices only the non-recurring lines", async () => {
    await travelTo(SEP(15));
    const quotationId = await recurringOrder({ withOneTimeLine: true });
    await createSubscriptionsForOrder({ quotationId });

    const { invoiceId, total } = await invoiceOneTimeLines({ quotationId });
    expect(invoiceId).not.toBeNull();

    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId! },
      include: { lines: true },
    });

    // Two laptops at the Gold price of 5,000, plus 18% GST.
    expect(invoice.invoiceType).toBe("ONE_TIME");
    expect(invoice.lines).toHaveLength(1);
    expect(invoice.subtotal.equals(D("10000"))).toBe(true);
    expect(invoice.taxAmount.equals(D("1800"))).toBe(true);
    expect(total.equals(D("11800"))).toBe(true);
  });

  it("shows the two kinds separately on the billing screen", async () => {
    await travelTo(SEP(15));
    const quotationId = await recurringOrder({ withOneTimeLine: true });
    await createSubscriptionsForOrder({ quotationId });

    const view = await getBillingSchedule(quotationId);

    expect(view.oneTime).toHaveLength(1);
    expect(view.oneTime[0].productName).toBe("Laptop Pro");
    expect(view.recurring).toHaveLength(1);
    expect(view.recurring[0].productName).toBe("Support Subscription");
  });

  it("leaves the recurring schedule untouched when the one-time invoice is raised", async () => {
    await travelTo(SEP(15));
    const quotationId = await recurringOrder({ withOneTimeLine: true });
    await createSubscriptionsForOrder({ quotationId });
    await invoiceOneTimeLines({ quotationId });

    const view = await getBillingSchedule(quotationId);
    expect(view.recurring[0].upcoming[0].status).toBe("SCHEDULED");
    expect(view.recurring[0].upcoming[0].amount.equals(D("6400"))).toBe(true);
  });

  it("refuses to invoice the one-time lines twice", async () => {
    await travelTo(SEP(15));
    const quotationId = await recurringOrder({ withOneTimeLine: true });
    await invoiceOneTimeLines({ quotationId });

    await expect(invoiceOneTimeLines({ quotationId })).rejects.toBeInstanceOf(ConflictError);
  });
});

/**
 * The delta covers the unused part of the current period and lands on the next
 * invoice, so the customer never gets a bill outside the normal cycle.
 */
describe("mid-cycle quantity change", () => {
  it("prorates over the 10 remaining days and applies it to the next invoice", async () => {
    await travelTo(SEP(15));
    const quotationId = await recurringOrder();
    await createSubscriptionsForOrder({ quotationId });
    await runBilling({ asOf: currentBusinessTime() }); // September now invoiced

    const subscription = await prisma.subscription.findFirstOrThrow({ where: { quotationId } });

    // The 21st of a 30-day month leaves 10 days including that day.
    await travelTo(SEP(21));
    const result = await changeSubscriptionQuantity({
      subscriptionId: subscription.id,
      newQuantity: 2,
      user: finance,
    });

    // 1 extra x 12,000 x 10 / 30
    expect(result.delta.equals(D("4000"))).toBe(true);
    expect(result.appliedToBillingDate?.toISOString().slice(0, 10)).toBe("2026-10-01");

    // October bills the new full amount plus the catch-up, in one document.
    const october = await prisma.billingSchedule.findFirstOrThrow({
      where: { subscriptionId: subscription.id, status: "SCHEDULED" },
      orderBy: { billingDate: "asc" },
    });
    expect(october.amount.equals(D("28000"))).toBe(true);
    expect(october.prorationNote).toContain("quantity change");
  });

  it("raises no invoice at the moment of the change", async () => {
    await travelTo(SEP(15));
    const quotationId = await recurringOrder();
    await createSubscriptionsForOrder({ quotationId });
    await runBilling({ asOf: currentBusinessTime() });

    const before = await prisma.invoice.count({ where: { quotationId } });
    const subscription = await prisma.subscription.findFirstOrThrow({ where: { quotationId } });

    await travelTo(SEP(21));
    await changeSubscriptionQuantity({
      subscriptionId: subscription.id,
      newQuantity: 2,
      user: finance,
    });

    expect(await prisma.invoice.count({ where: { quotationId } })).toBe(before);
  });

  it("moves later periods to the new full amount", async () => {
    await travelTo(SEP(15));
    const quotationId = await recurringOrder();
    await createSubscriptionsForOrder({ quotationId });
    await runBilling({ asOf: currentBusinessTime() });

    const subscription = await prisma.subscription.findFirstOrThrow({ where: { quotationId } });
    await travelTo(SEP(21));
    await changeSubscriptionQuantity({
      subscriptionId: subscription.id,
      newQuantity: 2,
      user: finance,
    });

    const later = await prisma.billingSchedule.findMany({
      where: { subscriptionId: subscription.id, status: "SCHEDULED" },
      orderBy: { billingDate: "asc" },
    });
    // The second future period carries the new amount with no catch-up.
    expect(later[1].amount.equals(D("24000"))).toBe(true);
  });

  it("rejects a non-positive quantity", async () => {
    await travelTo(SEP(15));
    const quotationId = await recurringOrder();
    await createSubscriptionsForOrder({ quotationId });
    const subscription = await prisma.subscription.findFirstOrThrow({ where: { quotationId } });

    await expect(
      changeSubscriptionQuantity({ subscriptionId: subscription.id, newQuantity: 0, user: finance }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("cancellation", () => {
  it("credits only the unused days of the paid period", async () => {
    await travelTo(SEP(1));
    const quotationId = await recurringOrder();
    await createSubscriptionsForOrder({ quotationId });
    await runBilling({ asOf: currentBusinessTime() }); // September paid in full

    const subscription = await prisma.subscription.findFirstOrThrow({ where: { quotationId } });

    // Cancelling on the 20th leaves the 21st to the 30th unused: 10 of 30 days.
    await travelTo(SEP(20));
    const result = await cancelSubscription({
      subscriptionId: subscription.id,
      user: finance,
      reason: "Customer moved to an annual contract",
    });

    expect(result.creditAmount.equals(D("4000"))).toBe(true);
    expect(result.creditNoteId).not.toBeNull();

    const reread = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(reread.status).toBe("CANCELLED");
  });

  it("cancels every future period", async () => {
    await travelTo(SEP(1));
    const quotationId = await recurringOrder();
    await createSubscriptionsForOrder({ quotationId });
    await runBilling({ asOf: currentBusinessTime() });

    const subscription = await prisma.subscription.findFirstOrThrow({ where: { quotationId } });
    await travelTo(SEP(20));
    await cancelSubscription({ subscriptionId: subscription.id, user: finance, reason: "Cancelled" });

    const stillScheduled = await prisma.billingSchedule.count({
      where: { subscriptionId: subscription.id, status: "SCHEDULED" },
    });
    expect(stillScheduled).toBe(0);
  });

  // No refund is owed for time already delivered.
  it("credits nothing when the period was never invoiced", async () => {
    await travelTo(SEP(15));
    const quotationId = await recurringOrder();
    await createSubscriptionsForOrder({ quotationId });

    const subscription = await prisma.subscription.findFirstOrThrow({ where: { quotationId } });
    const result = await cancelSubscription({
      subscriptionId: subscription.id,
      user: finance,
      reason: "Cancelled before the first bill",
    });

    expect(result.creditAmount.isZero()).toBe(true);
    expect(result.creditNoteId).toBeNull();
  });

  it("is a Finance decision, not a rep one", async () => {
    await travelTo(SEP(15));
    const quotationId = await recurringOrder();
    await createSubscriptionsForOrder({ quotationId });
    const subscription = await prisma.subscription.findFirstOrThrow({ where: { quotationId } });

    await expect(
      cancelSubscription({ subscriptionId: subscription.id, user: rep, reason: "nope" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

/** Quick Test step 8: recording a payment updates the invoice status. */
describe("payments", () => {
  it("marks an invoice paid when settled in full", async () => {
    await travelTo(SEP(15));
    const quotationId = await recurringOrder({ withOneTimeLine: true });
    const { invoiceId, total } = await invoiceOneTimeLines({ quotationId });

    const result = await recordPayment({ invoiceId: invoiceId!, amount: total, user: finance });

    expect(result.status).toBe("PAID");
    expect(result.dueAmount.isZero()).toBe(true);
  });

  it("marks it partially paid when settled in part", async () => {
    await travelTo(SEP(15));
    const quotationId = await recurringOrder({ withOneTimeLine: true });
    const { invoiceId } = await invoiceOneTimeLines({ quotationId });

    const result = await recordPayment({ invoiceId: invoiceId!, amount: "5000.00", user: finance });

    expect(result.status).toBe("PARTIALLY_PAID");
    expect(result.paidAmount.equals(D("5000"))).toBe(true);
    expect(result.dueAmount.equals(D("6800"))).toBe(true);
  });

  it("records the status change in the audit trail", async () => {
    await travelTo(SEP(15));
    const quotationId = await recurringOrder({ withOneTimeLine: true });
    const { invoiceId, total } = await invoiceOneTimeLines({ quotationId });
    await recordPayment({ invoiceId: invoiceId!, amount: total, user: finance });

    const trail = await auditTrailFor("Invoice", invoiceId!);
    const payment = trail.find((e) => e.action === "PAYMENT")!;
    expect(payment.fieldChanges).toMatchObject({
      status: { before: "ISSUED", after: "PAID" },
    });
  });

  it("refuses a rep and a non-positive amount", async () => {
    await travelTo(SEP(15));
    const quotationId = await recurringOrder({ withOneTimeLine: true });
    const { invoiceId } = await invoiceOneTimeLines({ quotationId });

    await expect(
      recordPayment({ invoiceId: invoiceId!, amount: "100", user: rep }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      recordPayment({ invoiceId: invoiceId!, amount: "0", user: finance }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
