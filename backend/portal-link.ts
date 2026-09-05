import { prisma } from "./src/db";
import { refreshClockOffset } from "./src/clock";
import { issuePortalLink } from "./src/auth/portal-tokens";

/**
 * Issue a fresh portal magic link for whichever customer has a quotation
 * currently shared with them. Links are single-use and expire, so this is run
 * on demand rather than printed once at seed time.
 */
(async () => {
  await refreshClockOffset();
  const shared = await prisma.quotation.findFirst({
    where: { portalStatus: { not: "NOT_SHARED" } },
    select: { quoteNumber: true, customerId: true, customer: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  if (!shared) {
    console.log("No quotation is shared to the portal. Run `npm run db:seed:demo` first.");
    return;
  }
  const link = await issuePortalLink(shared.customerId);
  console.log(`customer : ${shared.customer.name}`);
  console.log(`quotation: ${shared.quoteNumber}`);
  console.log(`expires  : ${link.expiresAt.toISOString()}`);
  console.log(`\nhttp://localhost:3001/portal/login?token=${link.rawToken}\n`);
  await prisma.$disconnect();
})();
