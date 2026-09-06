import type { PaymentMethod } from "../generated/prisma/enums";
import type { AuthzUser } from "../authz/roles";
import { assertCan } from "../authz/roles";
import { currentBusinessTime } from "../clock";
import { prisma } from "../db";
import { ConflictError, NotFoundError } from "../errors";
import {
  createSubscriptionsForOrder,
  invoiceOneTimeLines,
  recordPayment,
  runBilling,
  type BillingRunResult,
} from "./billing";
import { assertQuotationVisible } from "./quotations";

/**
 * The invoice ledger behind the billing screen, and taking a payment against it.
 *
 * `getBillingSchedule` answers "what will be billed": it names an invoice per
 * one-time line but carries no amounts, because the schedule is about timing.
 * Recording a payment needs the opposite - what is owed right now - so it reads
 * the invoices directly rather than trying to reconstruct them from the lines.
 *
 * `recordPayment` itself checks the `recordPayment` capability and stops there,
 * which is Finance/Operations only. Finance's row scope is real, so "which
 * order" still has to be asked, and it is asked here.
 */

export interface InvoiceLedgerRow {
  id: string;
  invoiceNumber: string;
  invoiceType: string;
  status: string;
  total: string;
  paidAmount: string;
  dueAmount: string;
  issueDate: string;
  dueDate: string | null;
  /** Nothing left to collect. The screen stops offering a payment button. */
  settled: boolean;
  /** Past its due date with money still outstanding. */
  overdue: boolean;
  payments: {
    id: string;
    amount: string;
    method: string;
    reference: string | null;
    paidAt: string;
  }[];
}

export async function listInvoicesFor(
  user: AuthzUser,
  quotationId: string,
): Promise<InvoiceLedgerRow[]> {
  // The ledger is internal: a portal identity holds no `billingSchedule`
  // subject, so it never reaches this even though it can see the order (D20).
  assertCan(user, "view", "billingSchedule");
  await assertQuotationVisible(user, quotationId);

  const invoices = await prisma.invoice.findMany({
    where: { quotationId },
    orderBy: { issueDate: "asc" },
    include: { payments: { orderBy: { paidAt: "asc" } } },
  });

  // D3: "overdue" is measured against business time, so a time-travelled
  // demo ages its invoices along with everything else.
  const now = currentBusinessTime();

  return invoices.map((invoice) => ({
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    invoiceType: invoice.invoiceType,
    status: invoice.status,
    total: invoice.total.toFixed(2),
    paidAmount: invoice.paidAmount.toFixed(2),
    dueAmount: invoice.dueAmount.toFixed(2),
    issueDate: invoice.issueDate.toISOString(),
    dueDate: invoice.dueDate?.toISOString() ?? null,
    settled: invoice.status === "PAID" || invoice.dueAmount.lessThanOrEqualTo(0),
    overdue:
      invoice.dueAmount.greaterThan(0) &&
      invoice.dueDate !== null &&
      invoice.dueDate.getTime() < now.getTime(),
    payments: invoice.payments.map((payment) => ({
      id: payment.id,
      amount: payment.amount.toFixed(2),
      method: payment.method,
      reference: payment.reference,
      paidAt: payment.paidAt.toISOString(),
    })),
  }));
}

export async function recordPaymentAs(
  user: AuthzUser,
  input: {
    invoiceId: string;
    amount: string;
    method?: PaymentMethod;
    reference?: string;
  },
): Promise<{ status: string; paidAmount: string; dueAmount: string }> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: input.invoiceId },
    select: { quotationId: true },
  });
  if (!invoice) throw new NotFoundError(`Invoice ${input.invoiceId} does not exist`);

  await assertQuotationVisible(user, invoice.quotationId);

  const result = await recordPayment({
    invoiceId: input.invoiceId,
    amount: input.amount,
    user,
    method: input.method,
    reference: input.reference,
  });

  // Decimals do not cross the server/client boundary, so they are strings by
  // the time this leaves the service rather than at each call site.
  return {
    status: result.status,
    paidAmount: result.paidAmount.toFixed(2),
    dueAmount: result.dueAmount.toFixed(2),
  };
}

// ---------------------------------------------------------------------------
// Raising the invoice in the first place
// ---------------------------------------------------------------------------

/**
 * Who may bill an order.
 *
 * The capability matrix has no `invoice` action - billing predates the product
 * having a screen that could raise one. Rather than inventing a capability and
 * quietly widening the matrix, the rule is written out here: invoicing belongs
 * to the same role that collects the money, which is Finance/Operations. That
 * is exactly what `recordPayment` names, so it is what is asserted.
 */
function assertMayBill(user: AuthzUser): void {
  assertCan(user, "recordPayment");
}

export interface IssuedBilling {
  invoiceId: string | null;
  invoiceTotal: string;
  subscriptionsCreated: number;
}

/**
 * Turn a confirmed order into what it owes.
 *
 * One act, because from the screen's point of view "bill this order" is one
 * decision: the one-time lines become an invoice and the recurring lines become
 * subscriptions with their schedules. Splitting them into two buttons would
 * make it possible to do half of it and leave an order half-billed.
 *
 * Nothing here could be reached from the product before - `invoiceOneTimeLines`
 * and `createSubscriptionsForOrder` were composed only by the demo seed - which
 * is why every invoice in the database was written by a script.
 */
export async function issueBillingAs(
  user: AuthzUser,
  quotationId: string,
): Promise<IssuedBilling> {
  assertMayBill(user);
  await assertQuotationVisible(user, quotationId);

  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: { status: true, quoteNumber: true },
  });
  if (!quotation) throw new NotFoundError(`Quotation ${quotationId} does not exist`);

  // Billing a quote nobody has agreed to would invoice a proposal.
  if (quotation.status !== "CONFIRMED") {
    throw new ConflictError(
      `${quotation.quoteNumber} is not confirmed yet, so there is nothing to bill.`,
    );
  }

  const subscriptions = await createSubscriptionsForOrder({ quotationId, actorId: user.id });
  const invoice = await invoiceOneTimeLines({ quotationId, actorId: user.id });

  return {
    invoiceId: invoice.invoiceId,
    invoiceTotal: invoice.total.toFixed(2),
    subscriptionsCreated: subscriptions.created,
  };
}

/**
 * Invoice every subscription period that has come due.
 *
 * Idempotent by construction - an entry moves to INVOICED as it is billed - so
 * pressing it twice on the same day raises nothing the second time. It is the
 * counterpart to the demo clock: advance the clock, run the cycle, and a
 * recurring invoice actually appears.
 */
export async function runBillingAs(user: AuthzUser): Promise<BillingRunResult> {
  assertMayBill(user);
  return runBilling({ actorId: user.id });
}
