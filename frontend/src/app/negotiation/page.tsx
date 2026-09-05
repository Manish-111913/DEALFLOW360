import { redirect } from "next/navigation";
import { listPortalQuotations, prisma, viewPortalQuotation } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { NegotiationClient } from "./_components/negotiation-client";

/**
 * Screen 6 - the Customer Negotiation Portal.
 *
 * This is the only screen written for the customer rather than for staff, and
 * `viewPortalQuotation` enforces that: an internal identity asking for a portal
 * view gets a 403 by design, because the portal DTO and the internal one are
 * deliberately different objects (D20 - the portal shape is a whitelist, with
 * no margin, cost or risk on it).
 *
 * So an internal user landing here is not an error to swallow; they are told
 * plainly that this is the customer's view and how to reach it.
 */
export default async function NegotiationPortalPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/negotiation");

  if (user.kind !== "PORTAL") {
    // Offer a way in: the seeded buyer accounts are reachable by magic link,
    // which staff issue. Showing the customer name makes it obvious whose view
    // this would be.
    const shared = await prisma.quotation.findFirst({
      where: { portalStatus: { not: "NOT_SHARED" } },
      select: { quoteNumber: true, customer: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });

    return (
      <NegotiationClient
        data={null}
        internalNotice={{
          role: user.role ?? "",
          sharedQuoteNumber: shared?.quoteNumber ?? null,
          sharedCustomer: shared?.customer.name ?? null,
        }}
      />
    );
  }

  const { id } = await searchParams;

  // A portal identity is scoped to its own customer, so this list is already
  // theirs - but most of it is historical orders they were never shown. Only a
  // quotation that has actually been shared belongs on this screen, so pick by
  // portal status rather than by recency.
  //
  // `listPortalQuotations`, not `listQuotations`: the internal row carries
  // margin and risk, and this screen is the customer's (D20).
  const mine = await listPortalQuotations(user);
  const shared = mine.filter((row) => row.portalStatus !== "NOT_SHARED");
  const chosenId = id ?? shared[0]?.id ?? null;

  if (!chosenId) return <NegotiationClient data={null} internalNotice={null} />;

  const result = await viewPortalQuotation(user, chosenId);
  if (result.status !== 200 || !result.quotation) {
    return <NegotiationClient data={null} internalNotice={null} />;
  }

  const quotation = result.quotation;

  return (
    <NegotiationClient
      data={{
        quotationId: chosenId,
        quoteNumber: quotation.quoteNumber,
        status: quotation.status,
        currency: quotation.currency,
        subtotal: quotation.subtotal,
        discountAmount: quotation.discountAmount,
        taxAmount: quotation.taxAmount,
        totalAmount: quotation.totalAmount,
        validUntil: quotation.validUntil,
        awaitingSellerReview: quotation.awaitingSellerReview,
        lines: quotation.lines.map((line) => ({
          lineId: line.lineId,
          productName: line.productName,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountPercentage: line.discountPercentage,
          lineTotal: line.lineTotal,
          taxAmount: line.taxAmount,
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
            lineId: comment.lineId,
            message: comment.message,
            createdAt: comment.createdAt.toISOString(),
          })),
        },
      }}
      internalNotice={null}
    />
  );
}
