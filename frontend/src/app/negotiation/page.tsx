import { redirect } from "next/navigation";
import { isDenyAll, prisma, scopeFor } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import { ROUTES } from "@/lib/navigation";
import { NegotiationClient } from "./_components/negotiation-client";

/**
 * Screen 6 - the internal view of the Customer Negotiation Portal.
 *
 * This screen used to be the customer's surface. It is not any more: customers
 * live at /my/quotations, which is a three-screen portal with its own shell,
 * its own dock and its own list. What remains here is the staff-facing half - a
 * member of the sales team opening this dock tile is told plainly whose view the
 * portal is and how to reach it.
 *
 * A portal identity that lands here is redirected to their own portal rather
 * than shown a second, older version of it. Two customer surfaces reading the
 * same data is exactly how they drift apart.
 */
export default async function NegotiationPortalPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/negotiation");
  if (user.kind === "PORTAL") redirect(ROUTES.customerHome);

  // Name a real shared quotation, so the notice can say whose portal this is
  // and staff can see the flow is live rather than theoretical.
  //
  // Scoped, which it previously was not: this named the most recent shared
  // quotation in the whole database, so a rep on one team was shown the customer
  // name and quote number of a deal on another team's book. Every other read in
  // the application composes `scopeFor`, and there is no reason this one should
  // be the exception just because it only renders a sentence.
  const scope = scopeFor(user, "Quotation");
  const shared = isDenyAll(scope)
    ? null
    : await prisma.quotation.findFirst({
        where: { AND: [{ portalStatus: { not: "NOT_SHARED" } }, scope] },
        select: { id: true, quoteNumber: true, customer: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      });

  return (
    <NegotiationClient
      data={null}
      internalNotice={{
        role: user.role ?? "",
        sharedQuotationId: shared?.id ?? null,
        sharedQuoteNumber: shared?.quoteNumber ?? null,
        sharedCustomer: shared?.customer.name ?? null,
      }}
    />
  );
}
