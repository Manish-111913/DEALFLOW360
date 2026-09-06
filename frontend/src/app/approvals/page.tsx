import {
  assertQuotationDecidable,
  currentBusinessTime,
  getApprovalOverview,
  getQuotation,
  listDecisionQueue,
} from "@dealflow/backend";
import { requireInternalUser } from "@/auth";
import { ApprovalsClient } from "./_components/approvals-client";
import type { ApprovalScreenData, QueueEntry } from "./_components/types";

/**
 * Screen 3 - Sales Operations & Discount Approval.
 *
 * The screen reviews one quotation, so the page has to choose which. It honours
 * `?id=` when given one and otherwise picks whatever has waited longest, which
 * is what a reviewer opening the queue wants. Everything else still pending is
 * passed down so they can move between deals without going back out.
 *
 * `assertQuotationVisible` runs before anything is loaded, because
 * `getApprovalOverview` and `getQuotation` are raw loaders that take an id and
 * check nothing - without that guard `?id=` would read any quotation in the
 * database.
 */
/** How long ago, measured against the business clock rather than the browser's. */
function ago(now: Date, then: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - then.getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const user = await requireInternalUser("/approvals");

  const { id } = await searchParams;
  const now = currentBusinessTime();

  /**
   * The reviewer's desk: their own pending deals, plus the ones they have been
   * asked to decide that sit outside their book. The merge and the reason it is
   * safe live in `listDecisionQueue`, next to the scope rule it widens.
   */
  const queue: QueueEntry[] = await listDecisionQueue(user);

  // listQuotations sorts by most recent activity, so the last entry is the one
  // that has been waiting longest - the right default for a review queue.
  const chosenId = id ?? queue[queue.length - 1]?.id ?? null;

  if (!chosenId) {
    return <ApprovalsClient data={null} queue={queue} />;
  }

  // Visible because it is theirs, or because it is theirs to decide.
  await assertQuotationDecidable(user, chosenId);

  const [overview, quotation] = await Promise.all([
    getApprovalOverview(user, chosenId),
    getQuotation(user, chosenId),
  ]);

  if (!overview || !quotation) {
    return <ApprovalsClient data={null} queue={queue} />;
  }

  // Decimal and Date do not cross into a client component intact, so everything
  // is flattened to primitives here rather than left to chance.
  const data: ApprovalScreenData = {
    quotationId: chosenId,
    quoteNumber: overview.quoteNumber,
    approvalState: overview.approvalState ?? "NONE",
    riskScore: Number(overview.riskScore),
    riskLevel: overview.riskLevel ?? "LOW",
    customerName: quotation.customer.name,
    customerTier: quotation.customer.tier,
    salesRepName: quotation.salesRep.name,
    totalAmount: quotation.totalAmount.toFixed(2),
    marginPercentage: quotation.marginPercentage.toFixed(2),
    subtotal: quotation.subtotal.toFixed(2),
    discountAmount: quotation.discountAmount.toFixed(2),
    validUntil: quotation.validUntil?.toISOString() ?? null,
    lines: quotation.lines.map((line) => ({
      id: line.id,
      productName: line.product.name,
      sku: line.product.sku,
      quantity: line.quantity,
      unitPrice: line.unitPrice.toFixed(2),
      lineTotal: line.lineTotal.toFixed(2),
      discountPercentage: Number(line.discountPercentage),
      discountCeiling: Number(line.discountCeiling),
      violationPoints: Number(line.violationPoints),
    })),
    factors: overview.factors.map((factor) => ({
      id: factor.id,
      source: factor.source,
      points: Number(factor.points),
      description: factor.description,
      formula: factor.formula,
    })),
    requests: overview.requests.map((request) => ({
      id: request.id,
      status: request.status,
      stepOrder: request.step.stepOrder,
      stepName: `Step ${request.step.stepOrder}`,
      approverRole: request.step.approverRole,
      triggerReason: request.triggerReason,
      decisionReason: request.decisionReason,
      requestedAt: request.requestedAt.toISOString(),
      requestedAgo: ago(now, request.requestedAt),
      actedAt: request.actedAt?.toISOString() ?? null,
    })),
  };

  return <ApprovalsClient data={data} queue={queue} />;
}
