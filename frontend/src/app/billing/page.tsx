import { assertQuotationVisible, getBillingSchedule, listQuotations } from "@dealflow/backend";
import { requireInternalUser } from "@/auth";
import { BillingClient } from "./_components/billing-client";

/**
 * Screen 5 - Subscription & Billing.
 *
 * Billing only exists for a confirmed order, so the page picks the most recent
 * one that actually has something billable - a subscription or an invoice -
 * rather than simply the newest confirmed quotation. After the historical seed
 * the newest is an order with neither, which would render an empty screen while
 * a perfectly good billed order sat one row further down.
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
    for (const candidate of confirmed.slice(0, 25)) {
      const found = await getBillingSchedule(user, candidate.id);
      if (found && (found.oneTime.length > 0 || found.recurring.length > 0)) {
        chosenId = candidate.id;
        schedule = found;
        break;
      }
    }
  }

  if (!chosenId || !schedule) return <BillingClient data={null} />;

  const header = confirmed.find((row) => row.id === chosenId);

  return (
    <BillingClient
      data={{
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
