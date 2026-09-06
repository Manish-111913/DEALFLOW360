import {
  assertQuotationVisible,
  can,
  getBillingSchedule,
  listInvoicesFor,
  listQuotations,
} from "@dealflow/backend";
import { requireInternalUser } from "@/auth";
import { BillingClient } from "./_components/billing-client";

/**
 * Screen 5 - Subscription & Billing.
 *
 * Billing only exists for a confirmed order, so the page prefers the most
 * recent one that already has something on it - a subscription or an invoice -
 * over one with neither, which after the historical seed is usually the newest.
 * When nothing has been billed anywhere it opens on the newest confirmed order
 * regardless, because that is the one whose first invoice is raised from here.
 *
 * `?id=` overrides, guarded by `assertQuotationVisible` because
 * `getBillingSchedule` takes an id and checks nothing itself.
 */
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const user = await requireInternalUser("/billing");

  const { id } = await searchParams;
  const confirmed = await listQuotations(user, { stage: "FULFILLMENT" });

  let chosenId = id ?? null;
  let schedule: Awaited<ReturnType<typeof getBillingSchedule>> | null = null;

  if (chosenId) {
    await assertQuotationVisible(user, chosenId);
    schedule = await getBillingSchedule(user, chosenId);
  } else {
    // Bounded walk: the historical corpus is ~40 orders and almost none of them
    // has a subscription, so scanning all of them would be wasted queries.
    //
    // An order with something already on it wins, but one with nothing billed
    // yet is now the fallback rather than being passed over. Nothing billed is
    // precisely the order somebody opens this screen to bill, and the button
    // that bills it lives on this page - so skipping it hid the only way to
    // raise a first invoice behind a hand-typed id.
    let fallbackId: string | null = null;
    let fallbackSchedule: Awaited<ReturnType<typeof getBillingSchedule>> | null = null;

    for (const candidate of confirmed.slice(0, 25)) {
      const found = await getBillingSchedule(user, candidate.id);
      if (!found) continue;
      if (found.oneTime.length > 0 || found.recurring.length > 0) {
        chosenId = candidate.id;
        schedule = found;
        break;
      }
      if (!fallbackSchedule) {
        fallbackId = candidate.id;
        fallbackSchedule = found;
      }
    }

    if (!schedule) {
      chosenId = fallbackId;
      schedule = fallbackSchedule;
    }
  }

  if (!chosenId || !schedule) return <BillingClient data={null} />;

  const header = confirmed.find((row) => row.id === chosenId);

  // What has actually been collected. The schedule above says when things bill;
  // this says what is still owed, which is the only part anyone can act on.
  const invoices = await listInvoicesFor(user, chosenId);

  // "Already billed" is the presence of the one-time invoice, not a flag on the
  // order - that is the same condition `invoiceOneTimeLines` itself refuses on,
  // so the button and the endpoint cannot disagree about it.
  const alreadyBilled = invoices.some((invoice) => invoice.invoiceType === "ONE_TIME");

  return (
    <BillingClient
      data={{
        invoices,
        canRecordPayment: can(user, "recordPayment"),
        // Invoicing belongs to the role that collects; the matrix has no
        // separate subject for it, so it is the same capability.
        canBill: can(user, "recordPayment"),
        billable: !alreadyBilled,
        quotationId: chosenId,
        quoteNumber: header?.quoteNumber ?? "",
        customerName: header?.customerName ?? "",
        orderTotal: header?.totalAmount ?? "0",
        oneTime: schedule.oneTime.map((line) => ({
          lineId: line.lineId,
          productName: line.productName,
          quantity: line.quantity,
          lineTotal: String(line.lineTotal),
          taxAmount: String(line.taxAmount),
          invoiceId: line.invoiceId,
          invoiceStatus: line.invoiceStatus,
        })),
        recurring: schedule.recurring.map((sub) => ({
          subscriptionId: sub.subscriptionId,
          productName: sub.productName,
          interval: sub.interval,
          quantity: sub.quantity,
          unitPrice: String(sub.unitPrice),
          status: sub.status,
          upcoming: sub.upcoming.map((period) => ({
            periodStart: period.periodStart.toISOString(),
            periodEnd: period.periodEnd.toISOString(),
            billingDate: period.billingDate.toISOString(),
            amount: String(period.amount),
            status: period.status,
            // The service explains its own proration; the screen prints that
            // rather than recomputing the fraction and risking disagreement.
            prorationNote: period.prorationNote,
          })),
        })),
      }}
    />
  );
}
