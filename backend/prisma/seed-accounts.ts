import { hashPassword } from "../src/auth/password";
import { issuePortalLink } from "../src/auth/portal-tokens";
import { currentBusinessTime, refreshClockOffset } from "../src/clock";
import { prisma } from "../src/db";

/**
 * Three linked accounts for hands-on testing, rebuilt from scratch each run.
 *
 * ---------------------------------------------------------------------------
 * WHAT "FRESH" CAN AND CANNOT MEAN
 * ---------------------------------------------------------------------------
 * These three own nothing: no quotations, no history, no alerts. But "sees
 * nothing" is not something an account can be given - it falls out of the role,
 * because row scope is decided by `scopeFor` and not by any per-user flag:
 *
 *   ADMIN          every row in the company. That is what admin means, so this
 *                  account will show the demo book however empty it is itself.
 *   SALES_MANAGER  their team's deals. This one manages a team of exactly
 *                  itself, so it starts at zero and grows only with what it
 *                  raises.
 *   PORTAL         their own customer's shared quotations, and nothing else.
 *
 * ---------------------------------------------------------------------------
 * INTERLINKED
 * ---------------------------------------------------------------------------
 * The point of the three is that they can transact with each other without
 * touching the seeded demo data:
 *
 *   the manager raises a quotation for the customer's account
 *     -> it is in the manager's own book, because they own it
 *     -> over a ceiling it routes for approval and they decide it themselves
 *     -> sharing it puts it in the customer's portal
 *     -> the customer negotiates or confirms, and the manager sees the reply
 *   the admin sees all of it, and owns none of it.
 *
 * So the account is assigned to the manager, the manager manages a team, and
 * the portal contact hangs off that same account. Nothing else connects them.
 *
 * ---------------------------------------------------------------------------
 * DELETE THEN CREATE
 * ---------------------------------------------------------------------------
 * Re-running rebuilds rather than upserts, so a second run is genuinely a fresh
 * start rather than a patch over the last one.
 *
 * The wrinkle is that a user who has done anything cannot simply be deleted:
 * `AuditLog.actorId` is `onDelete: Restrict`, so the moment one of these three
 * approves a quotation their row is pinned by the record of it. `retireOrDelete`
 * handles both cases - untouched accounts are deleted, used ones are renamed to
 * a `+retired-<id>` address and deactivated, keeping every audit entry exactly
 * where it was while freeing the address for the new account.
 */

const PASSWORD = "Manish@07";
const TEAM = "Manish Enterprise";
const ACCOUNT = "Vineela Enterprises";

const ADMIN = { email: "manishcse2006@gmail.com", name: "Manish Kota" };
const MANAGER = { email: "kotasriramamanish07@gmail.com", name: "Sriram Manish" };
const BUYER = { email: "chowdaryvineelan@gmail.com", name: "Vineela Chowdary" };

const EMAILS = [ADMIN.email, MANAGER.email, BUYER.email];

function log(label: string, detail: string): void {
  console.log(`  ${label.padEnd(16)}${detail}`);
}

/**
 * Remove the previous run entirely.
 *
 * Sessions, OAuth accounts and password-reset tokens all cascade from User, so
 * they need no separate pass - which matters for the admin address, because it
 * was first created by Google sign-in and carries an OAuth Account row.
 */
async function removeExisting(): Promise<void> {
  const customer = await prisma.customer.findUnique({ where: { name: ACCOUNT } });

  if (customer) {
    // A quotation would block the customer delete, and it would also mean these
    // accounts are no longer fresh. Removing them is the point of the rebuild.
    const quotations = await prisma.quotation.deleteMany({ where: { customerId: customer.id } });
    await prisma.portalAccessToken.deleteMany({ where: { customerId: customer.id } });
    // Portal users must go before the account they hang off.
    await prisma.user.deleteMany({ where: { customerId: customer.id } });
    await prisma.customer.delete({ where: { id: customer.id } });
    log("removed", `account ${ACCOUNT}${quotations.count ? ` and ${quotations.count} quotation(s)` : ""}`);
  }

  // The team references its manager, so it is unhooked before the user goes.
  const team = await prisma.salesTeam.findUnique({ where: { name: TEAM } });
  if (team) {
    await prisma.user.updateMany({ where: { salesTeamId: team.id }, data: { salesTeamId: null } });
    await prisma.salesTeam.update({ where: { id: team.id }, data: { managerId: null } });
    await prisma.salesTeam.delete({ where: { id: team.id } });
    log("removed", `team ${TEAM}`);
  }

  for (const email of EMAILS) await retireOrDelete(email);
}

/**
 * Free an address for reuse, whatever the account behind it has done.
 *
 * `AuditLog.actorId` is `onDelete: Restrict`, deliberately: an actor with
 * history is deactivated, never deleted, because deleting them would take the
 * record of what they decided with them. So an account that has approved a
 * quotation cannot be removed - and that is exactly what happens the moment
 * anyone actually uses these three for what they are for.
 *
 * Renaming is the way out, and it is the honest one. The old row keeps its id,
 * its audit trail and everything it decided; it simply stops holding the
 * address and stops being able to sign in. The fresh account takes the address.
 * Nothing is rewritten and nothing is lost.
 */
async function retireOrDelete(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return;

  const history = await prisma.auditLog.count({ where: { actorId: user.id } });
  if (history === 0) {
    await prisma.user.delete({ where: { id: user.id } });
    log("removed", email);
    return;
  }

  const [local, domain] = email.split("@");
  // Suffixed with the id, which is unique by construction, so retiring the same
  // address twice cannot collide on the second attempt.
  const retired = `${local}+retired-${user.id.slice(-6)}@${domain}`;
  await prisma.user.update({
    where: { id: user.id },
    data: { email: retired, active: false, updatedAt: currentBusinessTime() },
  });
  log("retired", `${email} -> ${retired} (${history} audit entr${history === 1 ? "y" : "ies"} kept)`);
}

async function main(): Promise<void> {
  await refreshClockOffset();
  const now = currentBusinessTime();
  const passwordHash = await hashPassword(PASSWORD);

  console.log("\nRebuilding the three test accounts\n");
  await removeExisting();

  const admin = await prisma.user.create({
    data: {
      email: ADMIN.email,
      name: ADMIN.name,
      kind: "INTERNAL",
      role: "ADMIN",
      passwordHash,
      active: true,
      createdAt: now,
      updatedAt: now,
    },
  });

  const manager = await prisma.user.create({
    data: {
      email: MANAGER.email,
      name: MANAGER.name,
      kind: "INTERNAL",
      role: "SALES_MANAGER",
      passwordHash,
      active: true,
      createdAt: now,
      updatedAt: now,
    },
  });

  // The team is what makes the manager's scope mean anything. It holds exactly
  // one member - the manager - so their book starts empty and contains only
  // what they go on to raise.
  const team = await prisma.salesTeam.create({
    data: { name: TEAM, managerId: manager.id, createdAt: now, updatedAt: now },
  });
  await prisma.user.update({ where: { id: manager.id }, data: { salesTeamId: team.id } });

  // Assigned to the manager, so the account is theirs to sell to. A tier is
  // required or the account cannot be quoted at all - a database trigger
  // refuses a quotation for a tier-less customer.
  const customer = await prisma.customer.create({
    data: {
      name: ACCOUNT,
      contactName: BUYER.name,
      email: BUYER.email,
      tier: "SILVER",
      status: "ACTIVE",
      assignedSalesRepId: manager.id,
      createdAt: now,
      updatedAt: now,
    },
  });

  const buyer = await prisma.user.create({
    data: {
      email: BUYER.email,
      name: BUYER.name,
      kind: "PORTAL",
      role: null,
      customerId: customer.id,
      // Stored, but not the way in: D18 signs customers in by single-use link,
      // and the internal password form refuses a PORTAL identity outright.
      passwordHash,
      active: true,
      createdAt: now,
      updatedAt: now,
    },
  });

  log("admin", `${admin.email}  (sees the whole company - that is what ADMIN means)`);
  log("manager", `${manager.email}  manages "${team.name}", 0 deals to start`);
  log("customer", `${buyer.email}  on ${customer.name} (SILVER), 0 quotations`);

  const link = await issuePortalLink(customer.id);
  console.log(`\n  password for the two staff accounts: ${PASSWORD}`);
  console.log("  the customer signs in by link (single use):");
  console.log(`    http://localhost:3000/portal/login?token=${link.rawToken}`);
  console.log(`    expires ${link.expiresAt.toISOString()}`);
  console.log(
    "\n  Try it end to end: sign in as the manager, raise a quotation for " +
      `${ACCOUNT}, share it, then open the link above.\n`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
