import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthzUser } from "../authz/roles";
import { ForbiddenError } from "../authz/roles";
import { prisma } from "../db";
import { invoiceOneTimeLines } from "./billing";
import { issueBillingAs, listInvoicesFor, recordPaymentAs, runBillingAs } from "./payments";
import { addQuotationLine, createQuotation } from "./quotations";

/**
 * The invoice ledger, and collecting against it.
 *
 * `recordPayment` asks only whether the caller may record payments at all -
 * Finance, and nobody else. Finance's row scope is by stage, so the case worth
 * a test is a finance user reaching an invoice on an order that has not got to
 * them, which the capability check alone would allow.
 */

let acmeId: string;
let repId: string;
let laptopId: string;
let finance: AuthzUser;
let rep: AuthzUser;
let buyer: AuthzUser;

const created: string[] = [];

/** An approved order carrying one invoiced one-time line. */
async function invoicedOrder(quantity: number): Promise<{ quotationId: string; invoiceId: string }> {
  const q = await createQuotation({ customerId: acmeId, salesRepId: repId });
  created.push(q.id);
  await addQuotationLine({
    quotationId: q.id,
    productId: laptopId,
    quantity,
    discountPercentage: "0",
  });
  await prisma.quotation.update({
    where: { id: q.id },
    data: { approvalState: "APPROVED", status: "CONFIRMED" },
  });

  const { invoiceId } = await invoiceOneTimeLines({ quotationId: q.id });
  if (!invoiceId) throw new Error("the fixture produced no invoice");
  return { quotationId: q.id, invoiceId };
}

beforeAll(async () => {
  acmeId = (await prisma.customer.findUniqueOrThrow({ where: { name: "Acme Industries" } })).id;
  const r = await prisma.user.findUniqueOrThrow({ where: { email: "priya@dealflow360.test" } });
  const f = await prisma.user.findUniqueOrThrow({ where: { email: "finance@dealflow360.test" } });
  const b = await prisma.user.findUniqueOrThrow({ where: { email: "buyer@acme.test" } });
  repId = r.id;
  rep = { id: r.id, kind: "INTERNAL", role: "SALES_REP", customerId: null, salesTeamId: r.salesTeamId };
  finance = { id: f.id, kind: "INTERNAL", role: "FINANCE_OPS", customerId: null, salesTeamId: null };
  buyer = { id: b.id, kind: "PORTAL", role: null, customerId: b.customerId, salesTeamId: null };

  laptopId = (await prisma.product.findUniqueOrThrow({ where: { sku: "HW-LAPTOP-PRO" } })).id;
});

afterAll(async () => {
  // Invoice relates to Quotation without a cascade - deliberately, because a
  // financial document should not vanish with the deal it came from - so the
  // fixture's invoices are removed explicitly before their orders.
  await prisma.invoice.deleteMany({ where: { quotationId: { in: created } } });
  await prisma.quotation.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

describe("the ledger", () => {
  it("reports what is owed, as strings", async () => {
    const { quotationId, invoiceId } = await invoicedOrder(2);

    const [invoice] = await listInvoicesFor(finance, quotationId);
    expect(invoice.id).toBe(invoiceId);
    // Money crosses to the browser as text: a Decimal turned into a JavaScript
    // number is how a rounding error reaches a ledger.
    expect(typeof invoice.dueAmount).toBe("string");
    expect(Number(invoice.dueAmount)).toBeGreaterThan(0);
    expect(invoice.settled).toBe(false);
    expect(invoice.payments).toEqual([]);
  });

  it("is closed to the customer, who may see the order but not its ledger (D20)", async () => {
    const { quotationId } = await invoicedOrder(1);
    await expect(listInvoicesFor(buyer, quotationId)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("recording a payment", () => {
  it("settles an invoice paid in full", async () => {
    const { quotationId, invoiceId } = await invoicedOrder(2);
    const [before] = await listInvoicesFor(finance, quotationId);

    const result = await recordPaymentAs(finance, {
      invoiceId,
      amount: before.dueAmount,
      method: "BANK_TRANSFER",
      reference: "UTR-TEST-1",
    });

    expect(result.status).toBe("PAID");
    expect(Number(result.dueAmount)).toBe(0);

    const [after] = await listInvoicesFor(finance, quotationId);
    expect(after.settled).toBe(true);
    expect(after.payments).toHaveLength(1);
    expect(after.payments[0].reference).toBe("UTR-TEST-1");
  });

  it("leaves an invoice open after a part payment", async () => {
    const { quotationId, invoiceId } = await invoicedOrder(2);
    const [before] = await listInvoicesFor(finance, quotationId);

    const result = await recordPaymentAs(finance, { invoiceId, amount: "100.00" });
    expect(result.status).not.toBe("PAID");
    expect(Number(result.dueAmount)).toBeCloseTo(Number(before.dueAmount) - 100, 2);

    const [after] = await listInvoicesFor(finance, quotationId);
    expect(after.settled).toBe(false);
  });

  it("refuses more than is outstanding", async () => {
    // An overpayment cannot be represented: dueAmount is clamped at zero, so
    // the invoice would read PAID with paidAmount above total and nothing
    // recording the difference. A real overpayment is a credit note.
    const { quotationId, invoiceId } = await invoicedOrder(1);
    const [invoice] = await listInvoicesFor(finance, quotationId);

    await expect(
      recordPaymentAs(finance, {
        invoiceId,
        amount: (Number(invoice.dueAmount) + 1).toFixed(2),
      }),
    ).rejects.toMatchObject({ status: 409 });

    // And the invoice is untouched by the refusal.
    const [after] = await listInvoicesFor(finance, quotationId);
    expect(after.paidAmount).toBe("0.00");
    expect(after.payments).toEqual([]);
  });

  it("refuses a sales rep", async () => {
    const { invoiceId } = await invoicedOrder(1);
    await expect(
      recordPaymentAs(rep, { invoiceId, amount: "10.00" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses an invoice that does not exist", async () => {
    await expect(
      recordPaymentAs(finance, { invoiceId: "nope", amount: "10.00" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("refuses an order Finance cannot see, despite holding the capability", async () => {
    // Same shape as the dispatch case: a draft has not reached Finance, whose
    // scope is by stage. The capability check alone would let this through.
    const draft = await createQuotation({ customerId: acmeId, salesRepId: repId });
    created.push(draft.id);
    await addQuotationLine({ quotationId: draft.id, productId: laptopId, quantity: 1 });
    const { invoiceId } = await invoiceOneTimeLines({ quotationId: draft.id });

    await expect(
      recordPaymentAs(finance, { invoiceId: invoiceId as string, amount: "10.00" }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("raising the invoice in the first place", () => {
  /** A confirmed order with lines, but nothing billed against it yet. */
  async function confirmedOrder(): Promise<string> {
    const q = await createQuotation({ customerId: acmeId, salesRepId: repId });
    created.push(q.id);
    await addQuotationLine({ quotationId: q.id, productId: laptopId, quantity: 3 });
    await prisma.quotation.update({
      where: { id: q.id },
      data: { approvalState: "APPROVED", status: "CONFIRMED" },
    });
    return q.id;
  }

  it("turns a confirmed order into an invoice", async () => {
    const quotationId = await confirmedOrder();
    expect(await listInvoicesFor(finance, quotationId)).toEqual([]);

    const issued = await issueBillingAs(finance, quotationId);
    expect(issued.invoiceId).toBeTruthy();
    expect(Number(issued.invoiceTotal)).toBeGreaterThan(0);

    const [invoice] = await listInvoicesFor(finance, quotationId);
    expect(invoice.dueAmount).toBe(issued.invoiceTotal);
    expect(invoice.settled).toBe(false);
  });

  it("refuses to bill the same order twice", async () => {
    const quotationId = await confirmedOrder();
    await issueBillingAs(finance, quotationId);
    await expect(issueBillingAs(finance, quotationId)).rejects.toMatchObject({ status: 409 });
  });

  it("refuses an order the customer has not confirmed", async () => {
    // Invoicing a draft would bill a proposal nobody has agreed to.
    const q = await createQuotation({ customerId: acmeId, salesRepId: repId });
    created.push(q.id);
    await addQuotationLine({ quotationId: q.id, productId: laptopId, quantity: 1 });
    await prisma.quotation.update({
      where: { id: q.id },
      data: { approvalState: "APPROVED" },
    });

    await expect(issueBillingAs(finance, q.id)).rejects.toThrow(/not confirmed/i);
  });

  it("refuses a sales rep", async () => {
    const quotationId = await confirmedOrder();
    await expect(issueBillingAs(rep, quotationId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(runBillingAs(rep)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("runs the recurring cycle idempotently", async () => {
    const first = await runBillingAs(finance);
    const second = await runBillingAs(finance);
    // Entries move to INVOICED as they bill, so a second run on the same day
    // finds nothing due.
    expect(second.entriesInvoiced).toBe(0);
    expect(first.entriesInvoiced).toBeGreaterThanOrEqual(0);
  });
});
