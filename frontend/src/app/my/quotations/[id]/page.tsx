import { notFound, redirect } from "next/navigation";
import { prisma, viewPortalQuotation } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { ROUTES } from "@/lib/navigation";
import { assertServesPortal } from "@/lib/surface";
import { QuotationDetailClient } from "./_components/quotation-detail-client";

/**
 * Screen C2 - Quotation Details & Negotiation.
 *
 * `viewPortalQuotation` is the only way this page reads a quotation, and it
 * answers three questions before it answers the fourth: is anyone signed in
 * (401), is this a customer (403), is this quotation theirs (403 for someone
 * else's, 404 for one that does not exist or was never shared). Only then does
 * it project the customer-safe DTO.
 *
 * That is why this file has no authorisation logic of its own. Adding a check
 * here would mean two places to keep right; the 403 for another customer's
 * quotation that F-7 requires is enforced in the service, where every caller
 * gets it.
 */
export default async function QuotationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  assertServesPortal();

  const user = await getCurrentUser();

  if (!user) redirect(`/login?callbackUrl=/my/quotations/${id}`);
  if (user.kind !== "PORTAL") redirect(ROUTES.home);

  const result = await viewPortalQuotation(user, id);

  // 403 and 404 both surface as "not found" to the customer. Distinguishing
  // them on screen would tell them that a quotation they cannot see exists.
  if (result.status !== 200 || !result.quotation) notFound();

  const quotation = result.quotation;
  const customer = user.customerId
    ? await prisma.customer.findUnique({
        where: { id: user.customerId },
        select: { name: true, assignedSalesRep: { select: { name: true } } },
      })
    : null;

  return (
    <QuotationDetailClient
      accountManager={customer?.assignedSalesRep?.name ?? null}
      customerName={customer?.name ?? "Your account"}
      quotation={{
        id,
        quoteNumber: quotation.quoteNumber,
        status: quotation.status,
        currency: quotation.currency,
        subtotal: quotation.subtotal,
        discountAmount: quotation.discountAmount,
        taxAmount: quotation.taxAmount,
        totalAmount: quotation.totalAmount,
        validUntil: quotation.validUntil,
        awaitingSellerReview: quotation.awaitingSellerReview,
        version: quotation.version,
        lines: quotation.lines.map((line) => ({
          lineId: line.lineId,
          productName: line.productName,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountPercentage: line.discountPercentage,
          lineTotal: line.lineTotal,
        })),
        conversation: {
          requests: quotation.conversation.requests.map((request) => ({
            id: request.id,
            lineId: request.lineId,
            requestType: request.requestType,
            requestedValue: request.requestedValue,
            reason: request.reason,
            status: request.status,
            createdAt: request.createdAt.toISOString(),
          })),
          comments: quotation.conversation.comments.map((comment) => ({
            id: comment.id,
            message: comment.message,
            createdAt: comment.createdAt.toISOString(),
          })),
        },
      }}
    />
  );
}
