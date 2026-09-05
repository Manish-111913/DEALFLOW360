import { Prisma } from "../generated/prisma/client";
import { appendAudit } from "../audit";
import { assertCan, type AuthzUser } from "../authz/roles";
import { currentBusinessTime } from "../clock";
import { prisma } from "../db";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import {
  buildSchedule,
  cancellationCredit,
  midCycleQuantityDelta,
  periodContaining,
} from "../engines/billing";
import { ADVISORY_LOCK } from "../locks";
import { getSettings } from "../settings";

/**
 * Subscriptions, billing schedules, invoices and payments.
 *
 * ---------------------------------------------------------------------------
 * ONE ORDER, TWO BILLING LOGICS
 * ---------------------------------------------------------------------------
 * §B7 requires one-time and recurring lines to live on the same order and bill
 * separately. They do:
 *
 *   one-time lines  -> a single ONE_TIME invoice raised on confirmation
 *   recurring lines -> a Subscription with a materialised BillingSchedule,
 *                      invoiced by runBilling() when each period comes due
 *
 * Neither waits for the other, and a change to one never moves the other.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SCHEDULE IS MATERIALISED
 * ---------------------------------------------------------------------------
 * Future periods are written as rows when the subscription is created, rather
 * than derived on every read. That makes the billing screen a plain table, and
 * turns a mid-cycle change into an edit of specific future rows - visible,
 * auditable - instead of a re-derivation nobody can check.
 */

const Decimal = Prisma.Decimal;

// ---------------------------------------------------------------------------
// Document numbering
// ---------------------------------------------------------------------------

async function nextInvoiceNumber(tx: Prisma.TransactionClient, now: Date): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK.billingRun})`;
  const { invoiceNumberPrefix, quoteNumberPadding } = await getSettings();
  const prefix = `${invoiceNumberPrefix}-${now.getUTCFullYear()}-`;
  const count = await tx.invoice.count({ where: { invoiceNumber: { startsWith: prefix } } });
  return `${prefix}${String(count + 1).padStart(quoteNumberPadding, "0")}`;
}

// ---------------------------------------------------------------------------
// 1. Subscriptions and their schedules
// ---------------------------------------------------------------------------

/**
 * Create a Subscription, and its forward schedule, for every recurring line.
 *
 * Called on order confirmation. Idempotent: a line that already has a
 * subscription is skipped, so confirming twice cannot double-bill.
 */
export async function createSubscriptionsForOrder(params: {
  quotationId: string;
  actorId?: string | null;
}): Promise<{ created: number }> {
  const quotation = await prisma.quotation.findUnique({
    where: { id: params.quotationId },
    include: {
      lines: {
        where: { isRecurring: true },
        include: { product: { select: { name: true } }, subscriptionPlan: true },
      },
    },
  });
  if (!quotation) throw new NotFoundError(`Quotation ${params.quotationId} does not exist`);

  const now = currentBusinessTime();
  const { currencyMinorUnits, billingPeriodsAhead } = await getSettings();
  let created = 0;

  for (const line of quotation.lines) {
    const already = await prisma.subscription.findFirst({
      where: { quotationLineId: line.id, status: { not: "CANCELLED" } },
    });
    if (already) continue;

    // A recurring line without a plan cannot be billed on any cycle.
    const plan =
      line.subscriptionPlan ??
      (await prisma.subscriptionPlan.findFirst({
        where: { productId: line.productId, isActive: true },
      }));
    if (!plan) {
      throw new ValidationError(
        `${line.product.name} is a recurring line but has no subscription plan.`,
        "subscriptionPlanId",
      );
    }

    const entries = buildSchedule({
      planAmount: line.unitPrice,
      quantity: line.quantity,
      startDate: now,
      interval: plan.billingInterval,
      periods: billingPeriodsAhead,
      minorUnits: currencyMinorUnits,
    });

    const subscription = await prisma.subscription.create({
      data: {
        quotationId: quotation.id,
        quotationLineId: line.id,
        customerId: quotation.customerId,
        planId: plan.id,
        quantity: line.quantity,
        currentPrice: line.unitPrice,
        startDate: now,
        nextBillingDate: entries[0]?.billingDate ?? null,
        createdAt: now,
        updatedAt: now,
        schedules: {
          create: entries.map((e) => ({
            periodStart: e.periodStart,
            periodEnd: e.periodEnd,
            billingDate: e.billingDate,
            amount: e.amount,
            prorationNote: e.prorationNote,
            createdAt: now,
            updatedAt: now,
          })),
        },
      },
    });

    await appendAudit({
      entityName: "Subscription",
      entityId: subscription.id,
      action: "CREATE",
      actorId: params.actorId ?? null,
      reason: `Subscription started for ${line.product.name}`,
      fieldChanges: {
        interval: plan.billingInterval,
        quantity: line.quantity,
        firstCharge: entries[0]?.amount.toFixed(currencyMinorUnits),
        firstChargeNote: entries[0]?.prorationNote,
      },
    });

    created += 1;
  }

  return { created };
}

// ---------------------------------------------------------------------------
// 2. The billing screen: one-time and recurring, side by side
// ---------------------------------------------------------------------------

export interface BillingScheduleView {
  oneTime: {
    lineId: string;
    productName: string;
    quantity: number;
    lineTotal: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    invoiceId: string | null;
    invoiceStatus: string | null;
  }[];
  recurring: {
    subscriptionId: string;
    productName: string;
    interval: string;
    quantity: number;
    unitPrice: Prisma.Decimal;
    status: string;
    upcoming: {
      periodStart: Date;
      periodEnd: Date;
      billingDate: Date;
      amount: Prisma.Decimal;
      status: string;
      prorationNote: string | null;
    }[];
  }[];
}

/**
 * §B7 - the two kinds of line are shown separately within the same order.
 *
 * `billingSchedule` is its own view subject in the matrix, and a portal
 * identity does not hold it: the invoice ledger and every posted adjustment
 * are internal (D20).
 */
export async function getBillingSchedule(
  user: AuthzUser,
  quotationId: string,
): Promise<BillingScheduleView> {
  assertCan(user, "view", "billingSchedule");

  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    include: {
      lines: { include: { product: { select: { name: true } } }, orderBy: { sequence: "asc" } },
      invoices: { include: { lines: true } },
      subscriptions: {
        include: {
          plan: true,
          quotationLine: { include: { product: { select: { name: true } } } },
          schedules: { orderBy: { billingDate: "asc" } },
        },
      },
    },
  });
  if (!quotation) throw new NotFoundError(`Quotation ${quotationId} does not exist`);

  const oneTimeInvoice = quotation.invoices.find((i) => i.invoiceType === "ONE_TIME");

  return {
    oneTime: quotation.lines
      .filter((l) => !l.isRecurring)
      .map((l) => ({
        lineId: l.id,
        productName: l.product.name,
        quantity: l.quantity,
        lineTotal: l.lineTotal,
        taxAmount: l.taxAmount,
        invoiceId: oneTimeInvoice?.id ?? null,
        invoiceStatus: oneTimeInvoice?.status ?? null,
      })),
    recurring: quotation.subscriptions.map((s) => ({
      subscriptionId: s.id,
      productName: s.quotationLine?.product.name ?? s.plan.name,
      interval: s.plan.billingInterval,
      quantity: s.quantity,
      unitPrice: s.currentPrice,
      status: s.status,
      upcoming: s.schedules.map((e) => ({
        periodStart: e.periodStart,
        periodEnd: e.periodEnd,
        billingDate: e.billingDate,
        amount: e.amount,
        status: e.status,
        prorationNote: e.prorationNote,
      })),
    })),
  };
}

// ---------------------------------------------------------------------------
// 3. Invoicing
// ---------------------------------------------------------------------------

/**
 * Raise the one-time invoice for an order.
 *
 * Independent of any subscription on the same order: it covers the non-recurring
 * lines only, and is raised once on confirmation.
 */
export async function invoiceOneTimeLines(params: {
  quotationId: string;
  actorId?: string | null;
}): Promise<{ invoiceId: string | null; total: Prisma.Decimal }> {
  const quotation = await prisma.quotation.findUnique({
    where: { id: params.quotationId },
    include: {
      lines: { where: { isRecurring: false }, include: { product: { select: { name: true } } } },
    },
  });
  if (!quotation) throw new NotFoundError(`Quotation ${params.quotationId} does not exist`);
  if (quotation.lines.length === 0) return { invoiceId: null, total: new Decimal(0) };

  const existing = await prisma.invoice.findFirst({
    where: { quotationId: params.quotationId, invoiceType: "ONE_TIME" },
  });
  if (existing) throw new ConflictError("The one-time lines have already been invoiced.");

  const now = currentBusinessTime();
  const { currencyMinorUnits, currencyCode } = await getSettings();

  const subtotal = quotation.lines.reduce((acc, l) => acc.plus(l.lineTotal), new Decimal(0));
  const taxAmount = quotation.lines.reduce((acc, l) => acc.plus(l.taxAmount), new Decimal(0));
  const total = subtotal.plus(taxAmount).toDecimalPlaces(currencyMinorUnits, Decimal.ROUND_HALF_UP);

  const invoice = await prisma.$transaction(async (tx) => {
    const invoiceNumber = await nextInvoiceNumber(tx, now);
    return tx.invoice.create({
      data: {
        invoiceNumber,
        quotationId: quotation.id,
        customerId: quotation.customerId,
        invoiceType: "ONE_TIME",
        status: "ISSUED",
        currency: currencyCode,
        subtotal,
        taxAmount,
        total,
        dueAmount: total,
        issueDate: now,
        createdAt: now,
        updatedAt: now,
        lines: {
          create: quotation.lines.map((l) => ({
            quotationLineId: l.id,
            description: `${l.product.name} x ${l.quantity}`,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            taxAmount: l.taxAmount,
            amount: l.lineTotal,
          })),
        },
      },
    });
  });

  await appendAudit({
    entityName: "Invoice",
    entityId: invoice.id,
    action: "INVOICE",
    actorId: params.actorId ?? null,
    reason: "One-time lines invoiced on confirmation",
    fieldChanges: { invoiceNumber: invoice.invoiceNumber, total: total.toFixed(currencyMinorUnits) },
  });

  return { invoiceId: invoice.id, total };
}

export interface BillingRunResult {
  asOf: Date;
  entriesInvoiced: number;
  invoicesCreated: number;
}

/**
 * Invoice every schedule entry that has come due.
 *
 * Idempotent: an entry moves to INVOICED as it is billed, so running twice for
 * the same date raises nothing the second time. That matters because this is
 * exposed as a button for the demo as well as running on a timer.
 *
 * Time comes from the caller (D3), so advancing the demo clock and pressing
 * Run Billing shows a recurring invoice actually appearing - the whole reason
 * the application clock exists.
 */
export async function runBilling(params?: {
  asOf?: Date;
  actorId?: string | null;
}): Promise<BillingRunResult> {
  const asOf = params?.asOf ?? currentBusinessTime();
  const { currencyMinorUnits, currencyCode } = await getSettings();

  const due = await prisma.billingSchedule.findMany({
    where: { status: "SCHEDULED", billingDate: { lte: asOf } },
    include: {
      subscription: {
        include: {
          quotationLine: { include: { product: { select: { name: true } } } },
          plan: true,
        },
      },
    },
    orderBy: { billingDate: "asc" },
  });

  // One invoice per subscription per run keeps each recurring line traceable to
  // its own document, which is what the billing screen shows.
  const bySubscription = new Map<string, typeof due>();
  for (const entry of due) {
    if (entry.subscription.status === "CANCELLED") continue;
    const list = bySubscription.get(entry.subscriptionId) ?? [];
    list.push(entry);
    bySubscription.set(entry.subscriptionId, list);
  }

  let invoicesCreated = 0;
  let entriesInvoiced = 0;

  for (const [subscriptionId, entries] of bySubscription) {
    const subscription = entries[0].subscription;
    const subtotal = entries.reduce((acc, e) => acc.plus(e.amount), new Decimal(0));
    const total = subtotal.toDecimalPlaces(currencyMinorUnits, Decimal.ROUND_HALF_UP);

    await prisma.$transaction(async (tx) => {
      const invoiceNumber = await nextInvoiceNumber(tx, asOf);
      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber,
          quotationId: subscription.quotationId,
          customerId: subscription.customerId,
          invoiceType: "RECURRING",
          status: "ISSUED",
          currency: currencyCode,
          subtotal,
          total,
          dueAmount: total,
          issueDate: asOf,
          createdAt: asOf,
          updatedAt: asOf,
          lines: {
            create: entries.map((e) => ({
              quotationLineId: subscription.quotationLineId,
              description:
                `${subscription.quotationLine?.product.name ?? subscription.plan.name}` +
                ` (${e.periodStart.toISOString().slice(0, 10)} to ${e.periodEnd.toISOString().slice(0, 10)})` +
                (e.prorationNote ? ` - ${e.prorationNote}` : ""),
              quantity: subscription.quantity,
              unitPrice: subscription.currentPrice,
              amount: e.amount,
            })),
          },
        },
      });

      // Only entries still SCHEDULED are claimed, so two concurrent runs cannot
      // bill the same period twice.
      const claimed = await tx.billingSchedule.updateMany({
        where: { id: { in: entries.map((e) => e.id) }, status: "SCHEDULED" },
        data: { status: "INVOICED", invoiceId: invoice.id, updatedAt: asOf },
      });

      entriesInvoiced += claimed.count;
      invoicesCreated += 1;

      const nextEntry = await tx.billingSchedule.findFirst({
        where: { subscriptionId, status: "SCHEDULED" },
        orderBy: { billingDate: "asc" },
      });
      await tx.subscription.update({
        where: { id: subscriptionId },
        data: { nextBillingDate: nextEntry?.billingDate ?? null, updatedAt: asOf },
      });
    });
  }

  if (invoicesCreated > 0) {
    await appendAudit({
      entityName: "Invoice",
      entityId: "billing-run",
      action: "INVOICE",
      actorId: params?.actorId ?? null,
      reason: `Billing run for ${asOf.toISOString().slice(0, 10)}`,
      fieldChanges: { invoicesCreated, entriesInvoiced },
    });
  }

  return { asOf, entriesInvoiced, invoicesCreated };
}

// ---------------------------------------------------------------------------
// 4. Mid-cycle change and cancellation
// ---------------------------------------------------------------------------

/**
 * Change a subscription quantity mid-period.
 *
 * The prorated difference for the unused part of the current period is added to
 * the *next* scheduled invoice, and every later period moves to the new full
 * amount. The customer never sees a bill outside the normal cycle.
 */
export async function changeSubscriptionQuantity(params: {
  subscriptionId: string;
  newQuantity: number;
  user: AuthzUser;
}): Promise<{ delta: Prisma.Decimal; appliedToBillingDate: Date | null }> {
  // Not "update": every internal role has that, so gating on it let a SALES_REP
  // rewrite a customer's recurring billing and post a prorated adjustment to
  // the ledger. A seat reduction issues a credit exactly as a cancellation
  // does, so it is governed by the same capability - which D17 puts with
  // Finance/Operations - and `cancelSubscription` already uses it.
  assertCan(params.user, "issueCredit");

  if (params.newQuantity <= 0) {
    throw new ValidationError("Quantity must be greater than zero.", "quantity");
  }

  const subscription = await prisma.subscription.findUnique({
    where: { id: params.subscriptionId },
    include: { plan: true },
  });
  if (!subscription) throw new NotFoundError(`Subscription ${params.subscriptionId} does not exist`);
  if (subscription.status === "CANCELLED") {
    throw new ConflictError("This subscription has been cancelled.");
  }
  if (subscription.quantity === params.newQuantity) {
    return { delta: new Decimal(0), appliedToBillingDate: null };
  }

  const now = currentBusinessTime();
  const { currencyMinorUnits } = await getSettings();

  const delta = midCycleQuantityDelta({
    unitPrice: subscription.currentPrice,
    oldQuantity: subscription.quantity,
    newQuantity: params.newQuantity,
    changeDate: now,
    interval: subscription.plan.billingInterval,
    minorUnits: currencyMinorUnits,
  });

  const newFullAmount = subscription.currentPrice
    .times(params.newQuantity)
    .toDecimalPlaces(currencyMinorUnits, Decimal.ROUND_HALF_UP);

  const appliedTo = await prisma.$transaction(async (tx) => {
    const next = await tx.billingSchedule.findFirst({
      where: { subscriptionId: subscription.id, status: "SCHEDULED" },
      orderBy: { billingDate: "asc" },
    });

    // Later periods bill the new quantity outright.
    await tx.billingSchedule.updateMany({
      where: { subscriptionId: subscription.id, status: "SCHEDULED" },
      data: { amount: newFullAmount, updatedAt: now },
    });

    if (next) {
      await tx.billingSchedule.update({
        where: { id: next.id },
        data: {
          amount: newFullAmount.plus(delta.amount),
          prorationNote:
            `Includes ${delta.amount.toFixed(currencyMinorUnits)} for a quantity change ` +
            `part-way through the previous period (${delta.daysCharged} of ${delta.daysInPeriod} days)`,
          updatedAt: now,
        },
      });
    }

    await tx.subscription.update({
      where: { id: subscription.id },
      data: { quantity: params.newQuantity, updatedAt: now },
    });

    return next?.billingDate ?? null;
  });

  await appendAudit({
    entityName: "Subscription",
    entityId: subscription.id,
    action: "UPDATE",
    actorId: params.user.id,
    reason: "Subscription quantity changed mid-cycle",
    fieldChanges: {
      quantity: { before: subscription.quantity, after: params.newQuantity },
      prorationDelta: delta.amount.toFixed(currencyMinorUnits),
      appliedTo: appliedTo?.toISOString().slice(0, 10) ?? "no future period",
    },
  });

  return { delta: delta.amount, appliedToBillingDate: appliedTo };
}

/**
 * Cancel a subscription, crediting the unused part of the current paid period.
 *
 * No credit is owed for time already delivered, so cancelling at the end of a
 * period produces a zero credit rather than a negative one.
 */
export async function cancelSubscription(params: {
  subscriptionId: string;
  user: AuthzUser;
  reason: string;
}): Promise<{ creditAmount: Prisma.Decimal; creditNoteId: string | null }> {
  assertCan(params.user, "issueCredit");

  if (!params.reason?.trim()) {
    throw new ValidationError("A cancellation needs a reason.", "reason");
  }

  const subscription = await prisma.subscription.findUnique({
    where: { id: params.subscriptionId },
    include: { plan: true },
  });
  if (!subscription) throw new NotFoundError(`Subscription ${params.subscriptionId} does not exist`);
  if (subscription.status === "CANCELLED") {
    throw new ConflictError("This subscription is already cancelled.");
  }

  const now = currentBusinessTime();
  const { currencyMinorUnits, creditNoteNumberPrefix, quoteNumberPadding } = await getSettings();
  const period = periodContaining(now, subscription.plan.billingInterval);

  // Credit is owed only against a period that was actually invoiced.
  const paidEntry = await prisma.billingSchedule.findFirst({
    where: {
      subscriptionId: subscription.id,
      status: "INVOICED",
      periodStart: { lte: now },
      periodEnd: { gte: now },
    },
    include: { invoice: true },
  });

  const credit = cancellationCredit({
    planAmount: subscription.currentPrice,
    quantity: subscription.quantity,
    cancelDate: now,
    interval: subscription.plan.billingInterval,
    minorUnits: currencyMinorUnits,
  });

  const creditAmount = paidEntry ? credit.amount : new Decimal(0);
  let creditNoteId: string | null = null;

  await prisma.$transaction(async (tx) => {
    await tx.billingSchedule.updateMany({
      where: { subscriptionId: subscription.id, status: "SCHEDULED" },
      data: { status: "CANCELLED", updatedAt: now },
    });

    await tx.subscription.update({
      where: { id: subscription.id },
      data: {
        status: "CANCELLED",
        cancelledAt: now,
        endDate: period.end,
        nextBillingDate: null,
        updatedAt: now,
      },
    });

    if (creditAmount.greaterThan(0)) {
      // Numbered the same way quotes and invoices are, from configuration
      // rather than a literal - a document series is exactly the kind of thing
      // a deployment changes without a code change.
      const prefix = `${creditNoteNumberPrefix}-${now.getUTCFullYear()}-`;
      const count = await tx.creditNote.count({
        where: { creditNoteNumber: { startsWith: prefix } },
      });
      const note = await tx.creditNote.create({
        data: {
          creditNoteNumber: `${prefix}${String(count + 1).padStart(quoteNumberPadding, "0")}`,
          invoiceId: paidEntry?.invoiceId ?? null,
          subscriptionId: subscription.id,
          amount: creditAmount,
          reason: `Cancellation: ${credit.daysCharged} unused of ${credit.daysInPeriod} days`,
          issuedAt: now,
          createdAt: now,
        },
      });
      creditNoteId = note.id;
    }
  });

  await appendAudit({
    entityName: "Subscription",
    entityId: subscription.id,
    action: "CREDIT_NOTE",
    actorId: params.user.id,
    reason: params.reason,
    fieldChanges: {
      creditAmount: creditAmount.toFixed(currencyMinorUnits),
      unusedDays: credit.daysCharged,
      daysInPeriod: credit.daysInPeriod,
    },
  });

  return { creditAmount, creditNoteId };
}

// ---------------------------------------------------------------------------
// 5. Payments
// ---------------------------------------------------------------------------

/**
 * Record a payment against an invoice.
 *
 * Quick Test step 8 asks that recording a payment updates the invoice status,
 * so the status is derived from the amounts rather than set by the caller.
 */
export async function recordPayment(params: {
  invoiceId: string;
  amount: Prisma.Decimal | string | number;
  user: AuthzUser;
  method?: "BANK_TRANSFER" | "CARD" | "CASH" | "CHEQUE" | "OTHER";
  reference?: string;
}): Promise<{ status: string; paidAmount: Prisma.Decimal; dueAmount: Prisma.Decimal }> {
  assertCan(params.user, "recordPayment");

  const amount = new Decimal(params.amount);
  if (amount.lessThanOrEqualTo(0)) {
    throw new ValidationError("A payment must be a positive amount.", "amount");
  }

  const invoice = await prisma.invoice.findUnique({ where: { id: params.invoiceId } });
  if (!invoice) throw new NotFoundError(`Invoice ${params.invoiceId} does not exist`);
  if (invoice.status === "CANCELLED") {
    throw new ConflictError("A cancelled invoice cannot be paid.");
  }

  const now = currentBusinessTime();
  const { currencyMinorUnits } = await getSettings();

  const paidAmount = invoice.paidAmount
    .plus(amount)
    .toDecimalPlaces(currencyMinorUnits, Decimal.ROUND_HALF_UP);
  const dueAmount = Decimal.max(
    new Decimal(0),
    invoice.total.minus(paidAmount),
  ).toDecimalPlaces(currencyMinorUnits, Decimal.ROUND_HALF_UP);

  const status = dueAmount.isZero()
    ? "PAID"
    : paidAmount.greaterThan(0)
      ? "PARTIALLY_PAID"
      : invoice.status;

  await prisma.$transaction(async (tx) => {
    await tx.payment.create({
      data: {
        invoiceId: invoice.id,
        amount,
        method: params.method ?? "BANK_TRANSFER",
        reference: params.reference ?? null,
        paidAt: now,
        createdAt: now,
      },
    });
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { paidAmount, dueAmount, status, updatedAt: now },
    });
  });

  await appendAudit({
    entityName: "Invoice",
    entityId: invoice.id,
    action: "PAYMENT",
    actorId: params.user.id,
    reason: `Payment recorded against ${invoice.invoiceNumber}`,
    fieldChanges: {
      amount: amount.toFixed(currencyMinorUnits),
      status: { before: invoice.status, after: status },
      dueAmount: dueAmount.toFixed(currencyMinorUnits),
    },
  });

  return { status, paidAmount, dueAmount };
}
