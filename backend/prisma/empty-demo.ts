import { prisma } from "../src/db";

/**
 * Strip the demo book, keep the machinery.
 *
 * The seeded narrative - the customers, their quotations, the shipments,
 * invoices, negotiations and health history - exists to show the product doing
 * something. Once you want to use it as your own system rather than look at
 * someone else's, all of that is noise: an ADMIN sees every row by design, so
 * "my empty company" and "a database full of demo deals" cannot both be true.
 *
 * What is deliberately NOT removed is everything an empty company still needs
 * to function: the catalogue, the tax and price lists, the discount tiers and
 * ceilings, the approval chain, the warehouses and their stock, the subscription
 * plans, and the system settings. Delete those and the first quotation you try
 * to raise fails, because a customer with no tier cannot be quoted and a line
 * with no product cannot be priced.
 *
 * The named test accounts survive too, along with the sales team and the
 * customer account they are wired to.
 *
 *   npx tsx --env-file=../.env prisma/empty-demo.ts
 */

/** Accounts and people that are kept whatever else goes. */
const KEEP_CUSTOMERS = ["Vineela Enterprises"];
const KEEP_USERS = [
  "manishcse2006@gmail.com",
  "kotasriramamanish07@gmail.com",
  "chowdaryvineelan@gmail.com",
];
const KEEP_TEAMS = ["Manish Enterprise"];

function log(label: string, detail: string | number): void {
  console.log(`  ${label.padEnd(26)}${detail}`);
}

/**
 * Empty the audit log, chain and all.
 *
 * This is the one place the script touches history, and it does so for two
 * reasons that turned out to be the same reason. Every entry in there describes
 * a demo deal that is about to stop existing, so leaving them would put a wall
 * of events about nothing on the compliance screen of a company that has done
 * nothing yet. And the demo buyers who wrote some of those entries are actors:
 * AuditLog.actorId is onDelete: Restrict, so while their entries stand they
 * cannot be deleted, and a portal user cannot be detached from their account
 * either - `User_internal_xor_portal` requires a PORTAL row to name a customer.
 * Their customers would be pinned behind them.
 *
 * It is all or nothing. `verifyAuditChain` walks from GENESIS_HASH and checks
 * each row against the one before it, so removing some entries would leave a
 * chain that fails verification for the rest of the database's life. Removing
 * every entry leaves the state a fresh install has: nothing to verify, and the
 * next entry written becomes the new genesis.
 *
 * D19's trigger is lifted for exactly this statement and restored immediately.
 * The application still has no path that can do this - only a reset script run
 * deliberately, by hand, against a database whose contents are being discarded.
 */
async function wipeAuditLog(): Promise<number> {
  const before = await prisma.auditLog.count();
  await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" DISABLE TRIGGER USER`);
  try {
    await prisma.$executeRawUnsafe(`DELETE FROM "AuditLog"`);
  } finally {
    await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" ENABLE TRIGGER USER`);
  }
  return before;
}

async function main(): Promise<void> {
  console.log("\nRemoving the demo book\n");

  const keptCustomers = await prisma.customer.findMany({
    where: { name: { in: KEEP_CUSTOMERS } },
    select: { id: true },
  });
  const keptCustomerIds = keptCustomers.map((c) => c.id);

  // Deleting the quotations takes their lines, versions, risk factors, approval
  // requests, allocations, shipments, backorders, negotiations, health
  // snapshots and alerts with them - all of those cascade from Quotation. The
  // financial documents are deliberately NOT cascaded, because an invoice
  // outliving the quote it came from is the point, so they go first and by hand.
  await prisma.creditNote.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.billingSchedule.deleteMany({});
  await prisma.invoiceLine.deleteMany({});
  const invoices = await prisma.invoice.deleteMany({});
  const subscriptions = await prisma.subscription.deleteMany({});
  log("invoices removed", invoices.count);
  log("subscriptions removed", subscriptions.count);

  const quotations = await prisma.quotation.deleteMany({});
  log("quotations removed", quotations.count);

  log("audit entries cleared", await wipeAuditLog());

  // Upsell recommendations hang off quotations and are already gone; the
  // pairings themselves are configuration and stay.
  const tokens = await prisma.portalAccessToken.deleteMany({
    where: { customerId: { notIn: keptCustomerIds } },
  });
  log("portal links removed", tokens.count);

  // The demo buyers, then the accounts they belonged to. This order matters:
  // a PORTAL row must name a customer, so the contact goes before the account
  // rather than being detached from it.
  const portalUsers = await prisma.user.deleteMany({
    where: { kind: "PORTAL", email: { notIn: KEEP_USERS } },
  });
  log("portal contacts removed", portalUsers.count);

  const customers = await prisma.customer.deleteMany({
    where: { name: { notIn: KEEP_CUSTOMERS } },
  });
  log("customers removed", customers.count);

  // A team's manager is a Restrict reference, so the post is vacated before the
  // person is removed. The team itself may be kept even when its manager is not.
  const staff = await prisma.user.findMany({
    where: { kind: "INTERNAL", email: { notIn: KEEP_USERS } },
    select: { id: true },
  });
  for (const person of staff) {
    await prisma.salesTeam.updateMany({ where: { managerId: person.id }, data: { managerId: null } });
    await prisma.user.delete({ where: { id: person.id } });
  }
  log("staff removed", staff.length);

  const teams = await prisma.salesTeam.deleteMany({ where: { name: { notIn: KEEP_TEAMS } } });
  log("sales teams removed", teams.count);

  console.log("\nKept, because an empty company still needs them\n");
  log("products", await prisma.product.count());
  log("categories", await prisma.productCategory.count());
  log("price lists", await prisma.priceList.count());
  log("discount tiers", await prisma.discountTier.count());
  log("category ceilings", await prisma.discountPolicy.count());
  log("approval steps", await prisma.approvalStep.count());
  log("warehouses", await prisma.warehouse.count());
  log("stock rows", await prisma.warehouseStock.count());
  log("subscription plans", await prisma.subscriptionPlan.count());
  log("upsell pairings", await prisma.productPairing.count());
  log("system settings", await prisma.systemSetting.count());

  console.log("");
  const people = await prisma.user.findMany({
    orderBy: { email: "asc" },
    include: { customer: { select: { name: true } }, salesTeam: { select: { name: true } } },
  });
  for (const person of people) {
    log(
      person.email,
      `${person.role ?? person.kind}${person.salesTeam ? ` - ${person.salesTeam.name}` : ""}` +
        `${person.customer ? ` - ${person.customer.name}` : ""}`,
    );
  }

  console.log("");
  log("customers remaining", await prisma.customer.count());
  log("quotations remaining", await prisma.quotation.count());
  log("invoices remaining", await prisma.invoice.count());
  log("audit entries remaining", await prisma.auditLog.count());
  console.log("");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
