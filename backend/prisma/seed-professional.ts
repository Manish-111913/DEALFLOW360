import { prisma } from "../src/db";
import type { AuthzUser } from "../src/authz/roles";
import type { CustomerTier } from "../src/generated/prisma/enums";
import { currentBusinessTime } from "../src/clock";
import { registerInternalUser } from "../src/auth/register";
import { createPortalUser } from "../src/auth/register";
import { decideApproval, submitForApproval } from "../src/services/approvals";
import { allocateFulfillment } from "../src/services/fulfillment";
import { shareWithCustomer, submitNegotiation } from "../src/services/portal";
import { addQuotationLine, createQuotation, recomputeQuotation } from "../src/services/quotations";
import { recomputeAllDealHealth } from "../src/services/deal-health";

/**
 * A demo database that makes role-based access visible.
 *
 * The base seed produces one sales team, which is enough to run the application
 * but not enough to *show* anything about authorisation: with every rep on the
 * same team, a manager's team scope and an admin's global scope return the same
 * rows, and "scoped" is indistinguishable from "unfiltered".
 *
 * So this adds a second team with its own manager and rep, and splits the
 * accounts between them. Now each role answers a different question:
 *
 *   Priya  (rep, North)      her own deals
 *   Rahul  (rep, North)      his own deals - not Priya's
 *   Meera  (manager, North)  both of theirs - and none of Divya's
 *   Arjun  (manager, South)  Divya's only
 *   Farid  (finance)         all of them
 *   Ada    (admin)           all of them
 *   buyers (portal)          one customer's shared quotations, nothing else
 *
 * Idempotent: every step checks for what it would create, so running it twice
 * is safe and running it after the demo has been used tops it back up rather
 * than duplicating anything.
 */

const PASSWORD = "DealFlow!2026";

function log(step: string, detail: string) {
  console.log(`  ${step.padEnd(24)} ${detail}`);
}

function authz(user: {
  id: string;
  kind: "INTERNAL" | "PORTAL";
  role: AuthzUser["role"];
  customerId: string | null;
  salesTeamId: string | null;
}): AuthzUser {
  return {
    id: user.id,
    kind: user.kind,
    role: user.role,
    customerId: user.customerId,
    salesTeamId: user.salesTeamId,
  };
}

/** Create an internal user, or return the existing one. */
async function ensureUser(params: {
  email: string;
  name: string;
  role: "SALES_REP" | "SALES_MANAGER" | "FINANCE_OPS" | "ADMIN";
  salesTeamId?: string | null;
}) {
  const existing = await prisma.user.findUnique({ where: { email: params.email } });
  if (existing) {
    // Team membership can change even when the person already exists.
    if (params.salesTeamId && existing.salesTeamId !== params.salesTeamId) {
      return prisma.user.update({
        where: { id: existing.id },
        data: { salesTeamId: params.salesTeamId, updatedAt: currentBusinessTime() },
      });
    }
    return existing;
  }

  return registerInternalUser({
    email: params.email,
    name: params.name,
    password: PASSWORD,
    role: params.role,
    salesTeamId: params.salesTeamId ?? undefined,
  });
}

async function ensureCustomer(params: {
  name: string;
  tier: CustomerTier;
  ownerId: string;
  email: string;
  contactName: string;
}) {
  const now = currentBusinessTime();
  const existing = await prisma.customer.findFirst({ where: { name: params.name } });

  if (existing) {
    return prisma.customer.update({
      where: { id: existing.id },
      data: {
        tier: params.tier,
        status: "ACTIVE",
        assignedSalesRepId: params.ownerId,
        updatedAt: now,
      },
    });
  }

  return prisma.customer.create({
    data: {
      name: params.name,
      tier: params.tier,
      status: "ACTIVE",
      email: params.email,
      contactName: params.contactName,
      currency: "INR",
      assignedSalesRepId: params.ownerId,
      createdAt: now,
      updatedAt: now,
    },
  });
}

/** Build a quotation with lines, priced through the real chain. */
async function buildQuotation(params: {
  customerId: string;
  salesRepId: string;
  lines: { sku: string; quantity: number; discount: string }[];
}) {
  const quotation = await createQuotation({
    customerId: params.customerId,
    salesRepId: params.salesRepId,
    actorId: params.salesRepId,
  });

  for (const line of params.lines) {
    const product = await prisma.product.findFirstOrThrow({ where: { sku: line.sku } });
    await addQuotationLine({
      quotationId: quotation.id,
      productId: product.id,
      quantity: line.quantity,
      discountPercentage: line.discount,
      actorId: params.salesRepId,
    });
  }

  await recomputeQuotation(quotation.id);
  return prisma.quotation.findUniqueOrThrow({ where: { id: quotation.id } });
}

async function main() {
  console.log("\nDealFlow360 - professional demo data\n");
  const now = currentBusinessTime();

  // ---------------------------------------------------------------------
  // 1. Tidy the artefacts automated tests leave behind.
  // ---------------------------------------------------------------------
  // Deactivated rather than deleted: an audited actor cannot be removed, which
  // is the property that makes the audit trail trustworthy in the first place.
  const staleUsers = await prisma.user.updateMany({
    where: {
      active: true,
      OR: [
        { email: { endsWith: "@example.test" } },
        { email: { startsWith: "signup-" } },
        { email: { startsWith: "newstaff-" } },
      ],
    },
    data: { active: false },
  });

  // Test-fixture accounts are removed rather than deactivated. Deactivating
  // them leaves their quotations in every list - "Tier Audit Co 1788591465340"
  // alongside real customers - and a demo database that looks like a test
  // database is not demo data. Their quotations go first: AuditLog names a
  // quotation by id rather than by foreign key precisely so history survives
  // the record, which is what makes this safe.
  const fixtureAccounts = await prisma.customer.findMany({
    where: { name: { startsWith: "Tier Audit Co" } },
    select: { id: true },
  });
  const fixtureIds = fixtureAccounts.map((c) => c.id);

  let removedQuotes = 0;
  let removedAccounts = 0;
  if (fixtureIds.length > 0) {
    removedQuotes = (
      await prisma.quotation.deleteMany({ where: { customerId: { in: fixtureIds } } })
    ).count;
    // Anything still referencing an account (a portal contact, say) keeps it
    // alive; deactivating is the fallback rather than failing the seed.
    for (const id of fixtureIds) {
      try {
        await prisma.customer.delete({ where: { id } });
        removedAccounts += 1;
      } catch {
        await prisma.customer.update({
          where: { id },
          data: { status: "INACTIVE", updatedAt: now },
        });
      }
    }
  }

  log(
    "tidied",
    `${staleUsers.count} test user(s), ${removedAccounts} test account(s), ${removedQuotes} test quotation(s)`,
  );

  // ---------------------------------------------------------------------
  // 2. Two teams, so "scoped" and "everything" are different answers.
  // ---------------------------------------------------------------------
  const north =
    (await prisma.salesTeam.findFirst({ where: { name: "North Enterprise" } })) ??
    (await prisma.salesTeam.create({
      data: { name: "North Enterprise", createdAt: now, updatedAt: now },
    }));

  const south =
    (await prisma.salesTeam.findFirst({ where: { name: "South Enterprise" } })) ??
    (await prisma.salesTeam.create({
      data: { name: "South Enterprise", createdAt: now, updatedAt: now },
    }));

  const meera = await ensureUser({
    email: "manager@dealflow360.test", name: "Meera Manager",
    role: "SALES_MANAGER", salesTeamId: north.id,
  });
  const priya = await ensureUser({
    email: "priya@dealflow360.test", name: "Priya Sharma",
    role: "SALES_REP", salesTeamId: north.id,
  });
  const rahul = await ensureUser({
    email: "rahul@dealflow360.test", name: "Rahul Verma",
    role: "SALES_REP", salesTeamId: north.id,
  });
  const arjun = await ensureUser({
    email: "arjun@dealflow360.test", name: "Arjun Nair",
    role: "SALES_MANAGER", salesTeamId: south.id,
  });
  const divya = await ensureUser({
    email: "divya@dealflow360.test", name: "Divya Menon",
    role: "SALES_REP", salesTeamId: south.id,
  });
  const farid = await prisma.user.findUniqueOrThrow({
    where: { email: "finance@dealflow360.test" },
  });

  await prisma.salesTeam.update({ where: { id: north.id }, data: { managerId: meera.id } });
  await prisma.salesTeam.update({ where: { id: south.id }, data: { managerId: arjun.id } });
  log("teams", `North (Meera: Priya, Rahul) · South (Arjun: Divya)`);

  // ---------------------------------------------------------------------
  // 3. Accounts, split across the two books.
  // ---------------------------------------------------------------------
  const acme = await ensureCustomer({
    name: "Acme Industries", tier: "GOLD", ownerId: priya.id,
    email: "procurement@acme.test", contactName: "Anita Rao",
  });
  const beta = await ensureCustomer({
    name: "Beta Industries", tier: "SILVER", ownerId: rahul.id,
    email: "purchasing@beta.test", contactName: "Ben Ortiz",
  });
  const cobalt = await ensureCustomer({
    name: "Cobalt Systems", tier: "BRONZE", ownerId: priya.id,
    email: "ops@cobalt.test", contactName: "Chandra Iyer",
  });
  const meridian = await ensureCustomer({
    name: "Meridian Logistics", tier: "GOLD", ownerId: divya.id,
    email: "sourcing@meridian.test", contactName: "Maya Pillai",
  });
  const vertex = await ensureCustomer({
    name: "Vertex Healthcare", tier: "SILVER", ownerId: divya.id,
    email: "supply@vertex.test", contactName: "Vikram Shah",
  });
  log("accounts", "Acme, Cobalt (Priya) · Beta (Rahul) · Meridian, Vertex (Divya)");

  // Portal contacts for the two customers that have a portal story.
  for (const [email, name, customerId] of [
    ["buyer@acme.test", "Anita Rao (Acme)", acme.id],
    ["buyer@beta.test", "Ben Ortiz (Beta)", beta.id],
  ] as const) {
    if (!(await prisma.user.findUnique({ where: { email } }))) {
      await createPortalUser({ email, name, customerId, actorId: meera.id });
    }
  }

  // ---------------------------------------------------------------------
  // 4. Deals, spread across owners and stages.
  // ---------------------------------------------------------------------
  // Guarded per intent rather than per row: using the demo consumes it - an
  // approval decided is an approval no longer pending - so each scenario is
  // rebuilt only when its slot is genuinely empty.
  const created: string[] = [];

  // Each scenario is recognised by the *state* it leaves behind rather than by
  // a marker column, because that is what actually matters: if there is no
  // pending approval on Acme any more, the demo needs one whether or not a row
  // with the right label exists.
  const needsPendingApproval = async (customerId: string, salesRepId: string) =>
    (await prisma.quotation.count({
      where: {
        customerId,
        salesRepId,
        status: "DRAFT",
        approvalState: { in: ["PENDING_MANAGER", "PENDING_FINANCE"] },
      },
    })) === 0;

  const needsOpenNegotiation = async (customerId: string) =>
    (await prisma.negotiation.count({ where: { customerId, status: "OPEN" } })) === 0;

  const needsOpenDraft = async (customerId: string, salesRepId: string) =>
    (await prisma.quotation.count({
      where: { customerId, salesRepId, status: "DRAFT", approvalState: "NONE" },
    })) === 0;

  const needsAllocatedOrder = async (customerId: string) =>
    (await prisma.fulfillmentAllocation.count({ where: { quotation: { customerId } } })) === 0;

  // (a) Priya / Acme - the golden deal: over ceiling, awaiting the manager.
  if (await needsPendingApproval(acme.id, priya.id)) {
    const q = await buildQuotation({
      customerId: acme.id, salesRepId: priya.id,
      lines: [
        { sku: "HW-LAPTOP-PRO", quantity: 10, discount: "12.00" },
        { sku: "SV-SETUP", quantity: 1, discount: "18.00" },
      ],
    });
    await submitForApproval({ quotationId: q.id, actorId: priya.id });
    await shareWithCustomer({ quotationId: q.id, actorId: priya.id });
    created.push(`${q.quoteNumber} Acme/Priya - over ceiling, pending manager, shared`);
  }

  // (b) Rahul / Beta - a customer negotiating right now.
  if (await needsOpenNegotiation(beta.id)) {
    const q = await buildQuotation({
      customerId: beta.id, salesRepId: rahul.id,
      lines: [
        { sku: "HW-LAPTOP-PRO", quantity: 6, discount: "8.00" },
        { sku: "SUB-SUPPORT", quantity: 1, discount: "5.00" },
      ],
    });
    await submitForApproval({ quotationId: q.id, actorId: rahul.id });
    await shareWithCustomer({ quotationId: q.id, actorId: rahul.id });

    const buyer = await prisma.user.findUniqueOrThrow({ where: { email: "buyer@beta.test" } });
    const line = await prisma.quotationLine.findFirstOrThrow({ where: { quotationId: q.id } });
    await submitNegotiation({
      user: authz(buyer),
      quotationId: q.id,
      requestType: "COUNTER_DISCOUNT",
      lineId: line.id,
      requestedValue: 17,
      reason: "Could you consider 17% across the package?",
    });
    created.push(`${q.quoteNumber} Beta/Rahul - customer counter-offer open`);
  }

  // (c) Priya / Cobalt - clean draft, nothing wrong with it.
  if (await needsOpenDraft(cobalt.id, priya.id)) {
    const q = await buildQuotation({
      customerId: cobalt.id, salesRepId: priya.id,
      lines: [{ sku: "SV-ONBOARD", quantity: 2, discount: "5.00" }],
    });
    created.push(`${q.quoteNumber} Cobalt/Priya - open draft`);
  }

  // (d) Divya / Meridian - approved and allocated, so fulfilment has content.
  if (await needsAllocatedOrder(meridian.id)) {
    const q = await buildQuotation({
      customerId: meridian.id, salesRepId: divya.id,
      lines: [{ sku: "HW-LAPTOP-PRO", quantity: 14, discount: "6.00" }],
    });
    const routed = await submitForApproval({ quotationId: q.id, actorId: divya.id });
    if (routed.approvalRequired) {
      const request = await prisma.approvalRequest.findFirst({
        where: { quotationId: q.id, status: "PENDING" },
      });
      if (request) {
        await decideApproval({ requestId: request.id, decision: "APPROVE", user: authz(arjun) });
      }
    }
    await allocateFulfillment({ quotationId: q.id, user: authz(farid) }).catch(() => {});
    created.push(`${q.quoteNumber} Meridian/Divya - approved and allocated`);
  }

  // (e) Divya / Vertex - a second South deal, so Arjun's queue is not one row.
  if (await needsPendingApproval(vertex.id, divya.id)) {
    const q = await buildQuotation({
      customerId: vertex.id, salesRepId: divya.id,
      lines: [
        { sku: "SV-SETUP", quantity: 1, discount: "22.00" },
        { sku: "HW-WARRANTY-EXT", quantity: 3, discount: "0.00" },
      ],
    });
    await submitForApproval({ quotationId: q.id, actorId: divya.id });
    created.push(`${q.quoteNumber} Vertex/Divya - over ceiling, pending South manager`);
  }

  for (const line of created) log("built", line);
  if (created.length === 0) log("built", "nothing new - every scenario was already present");

  // Health scores make the Deal Health board meaningful.
  const scored = await recomputeAllDealHealth();
  log("deal health", `${scored.scored} deal(s) scored`);

  // ---------------------------------------------------------------------
  // 5. What each role will see.
  // ---------------------------------------------------------------------
  console.log("\n  Row scope by identity:");
  const { listQuotations } = await import("../src/services/quotations");
  for (const [label, user] of [
    ["Ada (ADMIN)", await prisma.user.findUniqueOrThrow({ where: { email: "admin@dealflow360.test" } })],
    ["Meera (North manager)", meera],
    ["Arjun (South manager)", arjun],
    ["Priya (North rep)", priya],
    ["Rahul (North rep)", rahul],
    ["Divya (South rep)", divya],
    ["Farid (FINANCE_OPS)", farid],
  ] as const) {
    const rows = await listQuotations(authz(user));
    const customers = [...new Set(rows.map((r) => r.customerName))].sort();
    console.log(`    ${label.padEnd(24)} ${String(rows.length).padStart(3)} deal(s)  ${customers.join(", ") || "-"}`);
  }

  console.log("\n  Sign in with password:", PASSWORD);
  console.log("    admin@dealflow360.test      ADMIN");
  console.log("    manager@dealflow360.test    SALES_MANAGER  (North)");
  console.log("    arjun@dealflow360.test      SALES_MANAGER  (South)");
  console.log("    priya@dealflow360.test      SALES_REP      (North)");
  console.log("    rahul@dealflow360.test      SALES_REP      (North)");
  console.log("    divya@dealflow360.test      SALES_REP      (South)");
  console.log("    finance@dealflow360.test    FINANCE_OPS");
  console.log("\n  Customers sign in by magic link: npm run portal:link\n");
}

await main();
await prisma.$disconnect();
