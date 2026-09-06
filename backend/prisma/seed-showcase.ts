import { Prisma } from "../src/generated/prisma/client";
import type { CustomerTier, Role, UserKind } from "../src/generated/prisma/enums";
import { appendAudit } from "../src/audit";
import type { AuthzUser } from "../src/authz/roles";
import { createPortalUserAs, createCustomerAs } from "../src/services/account-admin";
import { currentBusinessTime, refreshClockOffset } from "../src/clock";
import { prisma } from "../src/db";
import { decideApproval } from "../src/services/approvals";
import { cancelSubscription } from "../src/services/billing";
import { createCustomer } from "../src/services/customers";
import { dispatchShipmentAs, recordDeliveryAs } from "../src/services/dispatch";
import {
  allocateFulfillment,
  overrideAllocation,
  planFulfillment,
  receiveStock,
} from "../src/services/fulfillment";
import { issueBillingAs, recordPaymentAs, runBillingAs } from "../src/services/payments";
import { confirmPortalQuotation, listMyQuotations, submitNegotiation } from "../src/services/portal";
import {
  addLineAs,
  createQuotationAs,
  shareWithCustomerAs,
  submitForApprovalAs,
} from "../src/services/quotation-authoring";
import { listQuotations, recomputeQuotation } from "../src/services/quotations";
import {
  escalateDeal,
  recomputeAllDealHealth,
  resolveAlertAs,
} from "../src/services/deal-health";
import { acceptUpsell, dismissUpsell, getUpsellSuggestions } from "../src/services/upsell";
import { registerInternalUser } from "../src/auth/register";

/**
 * The showcase demo layer.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS FOR
 * ---------------------------------------------------------------------------
 * `seed.ts` builds the half of the database that has exactly one right answer:
 * identity, the catalogue, the discount governance, the warehouses, and the ~40
 * historical orders whose whole job is to give the *derived* figures - the 0.72
 * co-purchase rate, each rep's rolling discount average - something real to be
 * derived from. Those numbers are frozen and the test suite reads them, so
 * nothing here touches them.
 *
 * What that leaves is a database in which nothing is in flight. Every quotation
 * is confirmed and in the past, one team owns every account, and half the
 * screens have genuinely nothing to render. This file is the narrative layer on
 * top: a second sales team whose book does not overlap the first, accounts at
 * every tier, buyers with portal logins, and deals sitting in every state the
 * schema can express - including the awkward ones nobody remembers to demo,
 * like a returned approval, an open backorder and a delivery that arrived late.
 *
 * Run it on a freshly reset database, after the base seed:
 *
 *     npm run db:reset && npm run db:seed
 *     npx tsx --env-file=../.env prisma/seed-showcase.ts
 *
 * ---------------------------------------------------------------------------
 * WRITTEN THROUGH THE ENGINES, NOT AROUND THEM
 * ---------------------------------------------------------------------------
 * Almost every row here is produced by the same service the product calls, and
 * usually by the caller-checked wrapper rather than the primitive underneath -
 * `createQuotationAs`, not `createQuotation`. That costs nothing and buys two
 * things: the seeded data obeys the rules the application enforces, and if a
 * rule changes the seed fails loudly instead of quietly writing a state the
 * product can no longer reach.
 *
 * There are exactly seven places where no code path exists to produce the state
 * a reviewer needs to see. Each is a named function with `RAW WRITE` in its
 * comment saying what is missing and why writing it directly is honest.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS SHAPED FOR A RESET DATABASE
 * ---------------------------------------------------------------------------
 * D19 makes AuditLog append-only, enforced by a trigger rather than by
 * convention, so there is no wipe-and-reseed available: this script can add but
 * never unwind. Everything it creates is therefore guarded on the unique key it
 * would collide with - an account name, an email, a warehouse code - so a
 * second run tops up what is missing rather than duplicating what is there.
 * Per-account stories are guarded as a whole, because half an account's story
 * is worse than none of it.
 */

const Decimal = Prisma.Decimal;
const DAY_MS = 86_400_000;

/** The same development password every seeded account uses. */
const PASSWORD = "DealFlow!2026";

/** Historical orders from the base seed carry this prefix; demo deals do not. */
const HISTORY_PREFIX = "H-";

// ---------------------------------------------------------------------------
// Small shared vocabulary
// ---------------------------------------------------------------------------

/**
 * The fields every service wants about a person, internal or portal.
 *
 * Deliberately structural rather than Prisma's `User`: the buyers, the reps and
 * the admin all flow through the same helpers, and a wider type would drag
 * password hashes through a script that has no business holding them.
 */
interface Person {
  id: string;
  name: string;
  email: string;
  kind: UserKind;
  role: Role | null;
  customerId: string | null;
  salesTeamId: string | null;
}

interface Account {
  id: string;
  name: string;
}

/** One thing this seed proves, and the screen a reviewer opens to see it. */
interface Scenario {
  shows: string;
  screen: string;
}

/**
 * A deal that has to look its age.
 *
 * Nothing in the product makes time pass for a single deal: the demo clock
 * moves everything at once, which is exactly the wrong instrument for showing
 * one stalled quote next to nine fresh ones. See `ageTheBoard`.
 */
interface AgeSpec {
  quotationId: string;
  quoteNumber: string;
  /** Days since the last thing anyone did to it. Drives the stalled penalty. */
  inactiveDays: number;
  /** Days it has been sitting on a reviewer. Drives the approval-delay penalty. */
  pendingDays?: number;
}

/**
 * What the story functions hand back to `main`.
 *
 * Passed in and written to rather than returned and merged, because every story
 * contributes to the same two lists and threading tuples back through ten call
 * sites reads worse than it works.
 *
 * Note what is *not* here: a map of the quotations later steps need. The triage
 * pass finds its deals by account and state instead, which is what makes a
 * second run behave - a story that skipped because it was already told would
 * have registered nothing in a map, and the escalation and the alert closures
 * would then silently stop happening.
 */
interface Ledger {
  scenarios: Scenario[];
  aged: AgeSpec[];
}

function note(ledger: Ledger, shows: string, screen: string): void {
  ledger.scenarios.push({ shows, screen });
}

function log(label: string, detail: string): void {
  console.log(`  ${label.padEnd(22)}${detail}`);
}

function heading(title: string): void {
  console.log(`\n${title}`);
}

/** Business time, offset by whole days. D3: the clock module is the only source. */
function daysFromNow(days: number): Date {
  return new Date(currentBusinessTime().getTime() + days * DAY_MS);
}

/**
 * The two authorisation questions, packaged for the services.
 *
 * `assertCan` (may this role at all) and `scopeFor` (which rows) both live
 * inside the services this file calls, and both need the same five fields.
 * Building them here rather than passing Prisma rows around keeps a portal
 * buyer and a sales manager indistinguishable at the call site, which is the
 * point: the service decides, not the caller.
 */
function authz(person: Person): AuthzUser {
  return {
    id: person.id,
    kind: person.kind,
    role: person.role,
    customerId: person.customerId,
    salesTeamId: person.salesTeamId,
  };
}

/**
 * Fail loudly when a service refuses.
 *
 * The portal calls answer with a status rather than throwing, which is right
 * for an HTTP surface and wrong for a seed: a 409 nobody checked would leave a
 * half-built story that looks fine until someone opens the screen. If the rules
 * have moved, the seed should be the thing that says so.
 */
function expectOk<T extends { status: number }>(result: T, what: string): T {
  if (result.status !== 200) {
    throw new Error(
      `${what} was refused with ${result.status}. The demo script and the business rules have drifted apart.`,
    );
  }
  return result;
}

// ---------------------------------------------------------------------------
// The cast
// ---------------------------------------------------------------------------

type AccountKey =
  | "acme"
  | "beta"
  | "cobalt"
  | "halcyon"
  | "northwind"
  | "meridian"
  | "vertex"
  | "sierra"
  | "quarry"
  | "lumen"
  | "pinnacle";

type BuyerKey = "acme" | "acmeFinance" | "beta" | "halcyon" | "meridian" | "vertex" | "lumen";

interface Cast {
  ada: Person;
  meera: Person;
  arjun: Person;
  farid: Person;
  priya: Person;
  rahul: Person;
  divya: Person;
  sanjay: Person;
  accounts: Record<AccountKey, Account>;
  buyers: Record<BuyerKey, Person>;
  /** Product id by SKU. Throws rather than returning undefined - see `sku`. */
  sku: (code: string) => string;
  /** Warehouse id by code. */
  depot: (code: string) => string;
}

// ---------------------------------------------------------------------------
// 1. People, and the second team that makes scoping visible
// ---------------------------------------------------------------------------

async function ensureTeam(name: string): Promise<{ id: string; name: string }> {
  const existing = await prisma.salesTeam.findUnique({ where: { name } });
  if (existing) return existing;
  const now = currentBusinessTime();
  return prisma.salesTeam.create({ data: { name, createdAt: now, updatedAt: now } });
}

async function ensureInternal(params: {
  email: string;
  name: string;
  role: Role;
  teamId?: string | null;
}): Promise<Person> {
  const existing = await prisma.user.findUnique({ where: { email: params.email } });

  if (existing) {
    // Team membership is the one thing that legitimately changes on someone who
    // already exists: the base seed puts every rep on North, and the second
    // team only comes into being here.
    if (params.teamId && existing.salesTeamId !== params.teamId) {
      return prisma.user.update({
        where: { id: existing.id },
        data: { salesTeamId: params.teamId, updatedAt: currentBusinessTime() },
      });
    }
    return existing;
  }

  return registerInternalUser({
    email: params.email,
    name: params.name,
    password: PASSWORD,
    role: params.role,
    salesTeamId: params.teamId ?? undefined,
  });
}

/**
 * Two teams, staffed two reps each.
 *
 * With one team, a manager's scope and an admin's scope return the same rows
 * and "scoped" is indistinguishable from "unfiltered" - which is the single
 * most important thing this demo has to make visible. Two managers whose books
 * do not intersect turn `scopeFor` from an assertion into something a reviewer
 * can see by signing in twice.
 */
async function seedPeople(): Promise<Omit<Cast, "accounts" | "buyers" | "sku" | "depot">> {
  const north = await ensureTeam("North Enterprise");
  const south = await ensureTeam("South Enterprise");

  const ada = await ensureInternal({
    email: "admin@dealflow360.test",
    name: "Ada Admin",
    role: "ADMIN",
  });
  const farid = await ensureInternal({
    email: "finance@dealflow360.test",
    name: "Farid Finance",
    role: "FINANCE_OPS",
  });

  const meera = await ensureInternal({
    email: "manager@dealflow360.test",
    name: "Meera Manager",
    role: "SALES_MANAGER",
    teamId: north.id,
  });
  const priya = await ensureInternal({
    email: "priya@dealflow360.test",
    name: "Priya Sharma",
    role: "SALES_REP",
    teamId: north.id,
  });
  const rahul = await ensureInternal({
    email: "rahul@dealflow360.test",
    name: "Rahul Verma",
    role: "SALES_REP",
    teamId: north.id,
  });

  const arjun = await ensureInternal({
    email: "arjun@dealflow360.test",
    name: "Arjun Nair",
    role: "SALES_MANAGER",
    teamId: south.id,
  });
  const divya = await ensureInternal({
    email: "divya@dealflow360.test",
    name: "Divya Menon",
    role: "SALES_REP",
    teamId: south.id,
  });
  const sanjay = await ensureInternal({
    email: "sanjay@dealflow360.test",
    name: "Sanjay Iyer",
    role: "SALES_REP",
    teamId: south.id,
  });

  // SalesTeam.managerId is unique, so this is set after the people exist rather
  // than in the create above.
  const now = currentBusinessTime();
  await prisma.salesTeam.update({
    where: { id: north.id },
    data: { managerId: meera.id, updatedAt: now },
  });
  await prisma.salesTeam.update({
    where: { id: south.id },
    data: { managerId: arjun.id, updatedAt: now },
  });

  log("teams", "North (Meera: Priya, Rahul) - South (Arjun: Divya, Sanjay)");
  return { ada, meera, arjun, farid, priya, rahul, divya, sanjay };
}

// ---------------------------------------------------------------------------
// 2. Accounts and the buyers who sign in against them
// ---------------------------------------------------------------------------

async function ensureAccount(params: {
  admin: Person;
  name: string;
  tier: CustomerTier | null;
  owner: Person;
  contactName: string;
  email: string;
}): Promise<Account> {
  const existing = await prisma.customer.findUnique({ where: { name: params.name } });

  if (existing) {
    // The base seed hands its three accounts to Priya; two of them belong to
    // other reps in this story. Re-pointing an existing account is the only
    // edit a second run makes, so books stay where this file says they are.
    if (existing.assignedSalesRepId !== params.owner.id) {
      return prisma.customer.update({
        where: { id: existing.id },
        data: { assignedSalesRepId: params.owner.id, updatedAt: currentBusinessTime() },
      });
    }
    return existing;
  }

  if (params.tier === null) {
    // `createCustomerAs` requires a tier, and it is right to: without one there
    // is no discount ceiling to check a line against, so every governance rule
    // downstream passes vacuously and the form must not be able to produce such
    // an account. This demo needs exactly that account - to show the New
    // Quotation picker refusing it - so it goes through the primitive the base
    // seed uses, which is the only path that can still write one.
    return createCustomer({
      name: params.name,
      tier: null,
      contactName: params.contactName,
      email: params.email,
      assignedSalesRepId: params.owner.id,
      actorId: params.admin.id,
    });
  }

  return createCustomerAs(authz(params.admin), {
    name: params.name,
    tier: params.tier,
    contactName: params.contactName,
    email: params.email,
    accountOwnerId: params.owner.id,
  });
}

async function ensureBuyer(params: {
  admin: Person;
  account: Account;
  email: string;
  name: string;
}): Promise<Person> {
  const existing = await prisma.user.findUnique({ where: { email: params.email } });
  if (existing) return existing;

  return createPortalUserAs(authz(params.admin), {
    customerId: params.account.id,
    email: params.email,
    name: params.name,
  });
}

/**
 * Eleven accounts, split cleanly between the two books.
 *
 * Every tier is represented, twice over, because a single Bronze account makes
 * the tier column look decorative. Two accounts are deliberately awkward:
 * Pinnacle has no tier and so cannot be quoted at all, and Lumen is closed down
 * at the end of this run once its story is told. Both exist to show a screen
 * doing the right thing with a record it cannot simply process.
 */
async function seedAccounts(
  people: Omit<Cast, "accounts" | "buyers" | "sku" | "depot">,
): Promise<{ accounts: Record<AccountKey, Account>; buyers: Record<BuyerKey, Person> }> {
  const { ada, priya, rahul, divya, sanjay } = people;

  const accounts: Record<AccountKey, Account> = {
    acme: await ensureAccount({
      admin: ada,
      name: "Acme Industries",
      tier: "GOLD",
      owner: priya,
      contactName: "Anita Rao",
      email: "procurement@acme.test",
    }),
    beta: await ensureAccount({
      admin: ada,
      name: "Beta Industries",
      tier: "SILVER",
      owner: rahul,
      contactName: "Ben Ortiz",
      email: "purchasing@beta.test",
    }),
    cobalt: await ensureAccount({
      admin: ada,
      name: "Cobalt Systems",
      tier: "BRONZE",
      owner: priya,
      contactName: "Chandra Iyer",
      email: "ops@cobalt.test",
    }),
    halcyon: await ensureAccount({
      admin: ada,
      name: "Halcyon Retail Group",
      tier: "SILVER",
      owner: priya,
      contactName: "Hema Krishnan",
      email: "buying@halcyon.test",
    }),
    northwind: await ensureAccount({
      admin: ada,
      name: "Northwind Fabrication",
      tier: "GOLD",
      owner: rahul,
      contactName: "Nikhil Bose",
      email: "supply@northwind.test",
    }),
    meridian: await ensureAccount({
      admin: ada,
      name: "Meridian Logistics",
      tier: "GOLD",
      owner: divya,
      contactName: "Maya Pillai",
      email: "sourcing@meridian.test",
    }),
    vertex: await ensureAccount({
      admin: ada,
      name: "Vertex Healthcare",
      tier: "SILVER",
      owner: divya,
      contactName: "Vikram Shah",
      email: "supply@vertex.test",
    }),
    sierra: await ensureAccount({
      admin: ada,
      name: "Sierra Foods",
      tier: "BRONZE",
      owner: sanjay,
      contactName: "Sneha Kulkarni",
      email: "orders@sierra.test",
    }),
    quarry: await ensureAccount({
      admin: ada,
      name: "Quarry Hill Mining",
      tier: "GOLD",
      owner: sanjay,
      contactName: "Qadir Hussain",
      email: "plant@quarryhill.test",
    }),
    lumen: await ensureAccount({
      admin: ada,
      name: "Lumen Diagnostics",
      tier: "SILVER",
      owner: divya,
      contactName: "Leela Menon",
      email: "admin@lumen.test",
    }),
    // No tier, on purpose. The New Quotation picker filters it out and
    // `assertCustomerCanBeQuoted` refuses it - and a database trigger refuses
    // it again beneath that. It is given no quotations for the same reason.
    pinnacle: await ensureAccount({
      admin: ada,
      name: "Pinnacle Ventures",
      tier: null,
      owner: sanjay,
      contactName: "Pooja Nair",
      email: "hello@pinnacle.test",
    }),
  };

  const buyers: Record<BuyerKey, Person> = {
    acme: await ensureBuyer({
      admin: ada,
      account: accounts.acme,
      email: "buyer@acme.test",
      name: "Anita Rao (Acme)",
    }),
    // A second contact on one account, because a real buying organisation has
    // more than one person in it and the portal contact list should not be a
    // column of ones.
    acmeFinance: await ensureBuyer({
      admin: ada,
      account: accounts.acme,
      email: "ap@acme.test",
      name: "Arun Desai (Acme, accounts payable)",
    }),
    beta: await ensureBuyer({
      admin: ada,
      account: accounts.beta,
      email: "buyer@beta.test",
      name: "Ben Ortiz (Beta)",
    }),
    halcyon: await ensureBuyer({
      admin: ada,
      account: accounts.halcyon,
      email: "buyer@halcyon.test",
      name: "Hema Krishnan (Halcyon)",
    }),
    meridian: await ensureBuyer({
      admin: ada,
      account: accounts.meridian,
      email: "buyer@meridian.test",
      name: "Maya Pillai (Meridian)",
    }),
    vertex: await ensureBuyer({
      admin: ada,
      account: accounts.vertex,
      email: "buyer@vertex.test",
      name: "Vikram Shah (Vertex)",
    }),
    lumen: await ensureBuyer({
      admin: ada,
      account: accounts.lumen,
      email: "buyer@lumen.test",
      name: "Leela Menon (Lumen)",
    }),
  };

  log("accounts", "11 across both books - every tier, one tier-less, one about to lapse");
  log("portal contacts", "6 accounts, Acme with two");
  return { accounts, buyers };
}

// ---------------------------------------------------------------------------
// 3. One more product, so billing has more than one cycle to show
// ---------------------------------------------------------------------------

/**
 * An annually billed subscription.
 *
 * The base seed has exactly one plan, and it is monthly. A billing screen that
 * only ever shows monthly rows proves nothing about the interval being real:
 * proration, period boundaries and the forward schedule all behave differently
 * on a yearly cycle, and this is what makes that visible.
 *
 * It is a new product rather than a second plan on the existing one, because
 * `createSubscriptionsForOrder` finds a line's plan by product when the line
 * does not name one. Two active plans for one product would make which cycle a
 * customer got depend on row order, which is not a thing a demo should teach.
 */
async function seedAnnualPlan(): Promise<void> {
  const existing = await prisma.product.findUnique({ where: { sku: "SUB-PLATFORM" } });
  if (existing) return;

  const now = currentBusinessTime();
  const category = await prisma.productCategory.findUniqueOrThrow({
    where: { name: "Subscriptions" },
  });
  const gst = await prisma.tax.findUnique({ where: { name: "GST 18%" } });

  const product = await prisma.product.create({
    data: {
      sku: "SUB-PLATFORM",
      name: "Platform Licence",
      description: "Per-site platform licence, billed annually.",
      categoryId: category.id,
      type: "SUBSCRIPTION",
      basePrice: "48000.00",
      costPrice: "16000.00",
      unit: "site/year",
      taxId: gst?.id ?? null,
      createdAt: now,
      updatedAt: now,
    },
  });

  await prisma.subscriptionPlan.create({
    data: {
      name: "Platform Licence - Annual",
      productId: product.id,
      billingInterval: "YEARLY",
      price: product.basePrice,
      createdAt: now,
      updatedAt: now,
    },
  });

  log("catalogue", "Platform Licence added, billed yearly");
}

// ---------------------------------------------------------------------------
// 4. The distribution network
// ---------------------------------------------------------------------------

/**
 * A third depot, deeper stock, and two rows that need replenishing.
 *
 * The base seed's twenty laptops are exactly enough for its own worked example
 * and nothing else; this story allocates, dispatches and backorders against the
 * same product several times over, so the network needs real depth or the
 * fourth order fails for a reason that has nothing to do with the demo.
 *
 * The top-ups go through `receiveStock`, which is the service a warehouse
 * operator would use, so each one leaves a receipt in the audit trail and gets
 * checked against open backorders on the way through. The new depot itself is
 * written directly: nothing in the application creates a warehouse or its
 * replenishment rules, which is precisely what makes the reorder columns
 * configuration rather than constants.
 */
async function seedNetwork(cast: Omit<Cast, "depot">): Promise<Map<string, string>> {
  const depots = new Map<string, string>();
  for (const w of await prisma.warehouse.findMany({ select: { id: true, code: true } })) {
    depots.set(w.code, w.id);
  }

  if (!depots.has("SOUTH")) {
    const now = currentBusinessTime();
    const south = await prisma.warehouse.create({
      data: {
        name: "South Hub",
        code: "SOUTH",
        address: "Plot 14, Hosur Road, Bengaluru",
        // Third in the priority walk, and the most expensive to ship from, so
        // the allocator only reaches for it when the other two cannot cover an
        // order. Both numbers are columns for a reason: §A4 asks for the
        // shipping-cost weighting the split logic uses to be administrable.
        priority: 3,
        shippingCost: "310.00",
        createdAt: now,
        updatedAt: now,
      },
    });
    depots.set(south.code, south.id);

    await appendAudit({
      entityName: "Warehouse",
      entityId: south.id,
      action: "CONFIGURE",
      actorId: cast.ada.id,
      reason: "Third depot opened for the southern book",
      fieldChanges: { code: south.code, priority: south.priority },
    });

    // Reorder levels above what is on the shelf, so the replenishment report on
    // the Settings screen has something to report. A stock row's own level wins
    // over the company-wide default, which is what makes per-row rules worth
    // having at all.
    const stock = [
      { sku: "HW-LAPTOP-PRO", availableQuantity: 6, reorderLevel: 10, reorderQuantity: 25 },
      { sku: "HW-WARRANTY-EXT", availableQuantity: 12, reorderLevel: 20, reorderQuantity: 40 },
      { sku: "SV-SETUP", availableQuantity: 50, reorderLevel: 10, reorderQuantity: 25 },
      { sku: "SV-ONBOARD", availableQuantity: 50, reorderLevel: 10, reorderQuantity: 25 },
    ];
    for (const row of stock) {
      await prisma.warehouseStock.create({
        data: {
          warehouseId: south.id,
          productId: cast.sku(row.sku),
          availableQuantity: row.availableQuantity,
          reorderLevel: row.reorderLevel,
          reorderQuantity: row.reorderQuantity,
          updatedAt: now,
        },
      });
    }
  }

  // Topped up only once: a second run would otherwise keep pouring laptops into
  // Main until the replenishment report stopped meaning anything.
  const main = depots.get("MAIN");
  const east = depots.get("EAST");
  const laptop = cast.sku("HW-LAPTOP-PRO");

  if (main) {
    const row = await prisma.warehouseStock.findFirst({
      where: { warehouseId: main, productId: laptop },
    });
    if (row && row.availableQuantity < 30) {
      await receiveStock({
        warehouseId: main,
        productId: laptop,
        quantity: 30 - row.availableQuantity,
        actorId: cast.farid.id,
      });
    }
  }
  if (east) {
    const row = await prisma.warehouseStock.findFirst({
      where: { warehouseId: east, productId: laptop },
    });
    if (row && row.availableQuantity < 15) {
      await receiveStock({
        warehouseId: east,
        productId: laptop,
        quantity: 15 - row.availableQuantity,
        actorId: cast.farid.id,
      });
    }
  }

  log("network", "Main 30, East Depot 15, South Hub opened (2 rows below reorder point)");
  return depots;
}

// ---------------------------------------------------------------------------
// Building blocks the stories share
// ---------------------------------------------------------------------------

/** One line, as a rep would type it. The discount is a Decimal string (D2). */
interface LineSpec {
  sku: string;
  quantity: number;
  discount?: string;
}

interface BuiltQuote {
  id: string;
  quoteNumber: string;
  total: Prisma.Decimal;
  marginPercentage: Prisma.Decimal;
  riskScore: number;
}

/**
 * Author a quotation the way the Sales Workspace does.
 *
 * Through `createQuotationAs` and `addLineAs` rather than the primitives
 * beneath them, so every deal in this file has passed the same two checks a
 * request from a browser would: may this role do this, and is this row theirs.
 * A rep always ends up owning what they create, whatever is passed in - which
 * is why no `salesRepId` is threaded through here.
 *
 * The closing `recomputeQuotation` is not redundant bookkeeping. Adding a line
 * already recomputes, but the figures this returns are then the finished ones
 * rather than those after whichever line happened to go on last, and the log
 * below prints them.
 */
async function authorQuote(params: {
  cast: Cast;
  rep: Person;
  account: Account;
  lines: LineSpec[];
  validForDays?: number;
}): Promise<BuiltQuote> {
  const quotation = await createQuotationAs(authz(params.rep), {
    customerId: params.account.id,
    validUntil: daysFromNow(params.validForDays ?? 30).toISOString(),
  });

  for (const line of params.lines) {
    await addLineAs(authz(params.rep), {
      quotationId: quotation.id,
      productId: params.cast.sku(line.sku),
      quantity: line.quantity,
      discountPercentage: line.discount ?? "0.00",
    });
  }

  const totals = await recomputeQuotation(quotation.id);
  return {
    id: quotation.id,
    quoteNumber: quotation.quoteNumber,
    total: totals.totalAmount,
    marginPercentage: totals.marginPercentage,
    riskScore: totals.riskScore,
  };
}

/**
 * Decide whichever approval step is next.
 *
 * `submitForApproval` opens every step the routing matched at once, so "the
 * pending one" means the lowest step order - and that ordering is what makes a
 * manager's capability check pass before finance's does. A manager asked to
 * decide a finance step is refused, which is the behaviour worth demonstrating
 * rather than working around.
 */
async function decide(params: {
  quotationId: string;
  reviewer: Person;
  decision: "APPROVE" | "REJECT" | "RETURN";
  reason?: string;
}): Promise<void> {
  const request = await prisma.approvalRequest.findFirst({
    where: { quotationId: params.quotationId, status: "PENDING" },
    orderBy: { step: { stepOrder: "asc" } },
    select: { id: true },
  });
  if (!request) {
    throw new Error(
      `Nothing is pending on quotation ${params.quotationId}, so the routing rules and this script disagree.`,
    );
  }

  await decideApproval({
    requestId: request.id,
    decision: params.decision,
    user: authz(params.reviewer),
    reason: params.reason,
  });
}

/** Has this account already had its demo story built? History does not count. */
async function alreadyTold(account: Account): Promise<boolean> {
  const live = await prisma.quotation.count({
    where: { customerId: account.id, quoteNumber: { not: { startsWith: HISTORY_PREFIX } } },
  });
  return live > 0;
}

// ---------------------------------------------------------------------------
// The seven states no code path can produce
// ---------------------------------------------------------------------------

/**
 * RAW WRITE - move a quotation from DRAFT to SENT.
 *
 * `shareWithCustomer` moves `portalStatus`, which is what the customer sees.
 * Nothing moves `status`: the only forward transition the product performs is
 * the customer's own confirmation, which jumps straight to CONFIRMED. The
 * column exists, the pipeline board reads it and the enum has four members, so
 * a demo that never produces SENT leaves a quarter of that board untested.
 */
async function markSent(quotationId: string, actor: Person): Promise<void> {
  const now = currentBusinessTime();
  await prisma.quotation.update({
    where: { id: quotationId },
    data: { status: "SENT", updatedAt: now, lastActivityAt: now },
  });
  await appendAudit({
    entityName: "Quotation",
    entityId: quotationId,
    action: "UPDATE",
    actorId: actor.id,
    reason: "Issued to the customer",
    fieldChanges: { status: { before: "DRAFT", after: "SENT" } },
  });
}

/**
 * RAW WRITE - close a quotation the customer walked away from.
 *
 * There is no cancel path at all: a rep can let a quote expire, and a reviewer
 * can reject it, but neither writes CANCELLED. It is the state a lapsed account
 * ends in, so the pipeline's closed column needs one.
 */
async function markCancelled(quotationId: string, actor: Person, reason: string): Promise<void> {
  const now = currentBusinessTime();
  await prisma.quotation.update({
    where: { id: quotationId },
    data: { status: "CANCELLED", updatedAt: now, lastActivityAt: now },
  });
  await appendAudit({
    entityName: "Quotation",
    entityId: quotationId,
    action: "UPDATE",
    actorId: actor.id,
    reason,
    fieldChanges: { status: { before: "DRAFT", after: "CANCELLED" } },
  });
}

/**
 * RAW WRITE - close an account down.
 *
 * `account-admin.ts` creates accounts and grants portal access but never
 * deactivates one, and `setCustomerTier` is the only field-level edit with a
 * service behind it. Deactivating rather than deleting is the same rule the
 * audit trail imposes everywhere else: a customer with history stays.
 */
async function deactivateAccount(account: Account, actor: Person, reason: string): Promise<void> {
  await prisma.customer.update({
    where: { id: account.id },
    data: { status: "INACTIVE", updatedAt: currentBusinessTime() },
  });
  await appendAudit({
    entityName: "Customer",
    entityId: account.id,
    action: "UPDATE",
    actorId: actor.id,
    reason,
    fieldChanges: { status: { before: "ACTIVE", after: "INACTIVE" } },
  });
}

/**
 * RAW WRITE - the seller's half of a negotiation thread.
 *
 * `submitNegotiation` writes a comment when a *customer* attaches a reason to a
 * request. There is no matching call for the rep answering, so every seeded
 * thread would otherwise be a monologue - and a conversation screen showing
 * only one side is worse than an empty one, because it looks like the reply was
 * lost rather than never written.
 */
async function sellerReply(params: {
  quotationId: string;
  author: Person;
  message: string;
}): Promise<void> {
  const negotiation = await prisma.negotiation.findFirst({
    where: { quotationId: params.quotationId },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
  if (!negotiation) return;

  const now = currentBusinessTime();
  await prisma.negotiationComment.create({
    data: {
      negotiationId: negotiation.id,
      authorId: params.author.id,
      message: params.message,
      createdAt: now,
    },
  });
  await appendAudit({
    entityName: "Quotation",
    entityId: params.quotationId,
    action: "NEGOTIATE",
    actorId: params.author.id,
    reason: "Seller replied on the negotiation thread",
  });
}

/**
 * RAW WRITE - a customer request the seller turned down.
 *
 * `submitNegotiation` resolves a counter-discount to one of the two ACCEPTED
 * outcomes and leaves everything else SUBMITTED; nothing ever writes REJECTED,
 * because declining is a conversation the product does not yet model. The enum
 * member exists and the thread renders it, so one request here is declined.
 */
async function declineNegotiationRequest(params: {
  requestId: string;
  quotationId: string;
  decider: Person;
  reason: string;
}): Promise<void> {
  const now = currentBusinessTime();
  await prisma.negotiationRequest.update({
    where: { id: params.requestId },
    data: { status: "REJECTED", resolvedAt: now },
  });
  await appendAudit({
    entityName: "Quotation",
    entityId: params.quotationId,
    action: "NEGOTIATE",
    actorId: params.decider.id,
    reason: params.reason,
    fieldChanges: { requestId: params.requestId, status: { before: "SUBMITTED", after: "REJECTED" } },
  });
}

/**
 * RAW WRITE - payment terms on an invoice.
 *
 * `invoiceOneTimeLines` stamps an issue date from the clock and leaves
 * `dueDate` null, because the system has no notion of terms yet - net 30 is not
 * configuration anywhere. Without a due date nothing is ever overdue, and the
 * receivables view has no ageing to show, so terms are written on here and one
 * invoice is deliberately issued far enough back to have gone past them.
 */
async function setPaymentTerms(params: {
  invoiceId: string;
  issuedDaysAgo: number;
  netDays: number;
  actor: Person;
}): Promise<void> {
  const issueDate = daysFromNow(-params.issuedDaysAgo);
  const dueDate = new Date(issueDate.getTime() + params.netDays * DAY_MS);

  await prisma.invoice.update({
    where: { id: params.invoiceId },
    data: { issueDate, dueDate, updatedAt: currentBusinessTime() },
  });
  await appendAudit({
    entityName: "Invoice",
    entityId: params.invoiceId,
    action: "UPDATE",
    actorId: params.actor.id,
    reason: `Payment terms set to net ${params.netDays}`,
    fieldChanges: { issueDate: issueDate.toISOString(), dueDate: dueDate.toISOString() },
  });
}

/**
 * RAW WRITE - make a deal look its age.
 *
 * Every health penalty that matters is a function of elapsed time, and the one
 * instrument the product has for that is the demo clock - which moves every
 * deal at once. A board on which everything is equally stale says nothing; the
 * whole point is one deal rotting next to nine that are fine. So the deals that
 * are meant to look neglected have their timestamps written back directly.
 *
 * This runs last, after every other write, because `recomputeQuotation` and
 * every service that touches a quotation stamp `lastActivityAt` forward again.
 */
async function ageTheBoard(aged: AgeSpec[]): Promise<void> {
  for (const spec of aged) {
    await prisma.quotation.update({
      where: { id: spec.quotationId },
      data: {
        lastActivityAt: daysFromNow(-spec.inactiveDays),
        ...(spec.pendingDays === undefined
          ? {}
          : { submittedAt: daysFromNow(-spec.pendingDays) }),
      },
    });
  }

  const summary = aged
    .map((s) => `${s.quoteNumber} (${s.inactiveDays}d idle${s.pendingDays ? `, ${s.pendingDays}d in review` : ""})`)
    .join(", ");
  log("aged", summary || "nothing to age - every deal was already built");
}

// ---------------------------------------------------------------------------
// 5. The stories, one per account
// ---------------------------------------------------------------------------

/**
 * Acme - the account that shows all three portal states at once.
 *
 * A buyer opening the portal should see a list, not a single row: one quote
 * they are being asked to look at, one they have already signed, and - by its
 * absence - one the rep is still working on internally. That third one is the
 * important one. `loadForPortal` treats an unshared quotation as not found even
 * for the customer it belongs to, and the only way to see that rule working is
 * to have a quotation it is hiding.
 */
async function tellAcme(cast: Cast, ledger: Ledger): Promise<void> {
  note(ledger, "One account holding a shared, an unshared and a confirmed quote", "Portal / My Quotations");
  note(ledger, "Two portal contacts on one account", "Accounts");
  note(ledger, "An order billed, paid in full and delivered on time", "Billing, Fulfillment");

  if (await alreadyTold(cast.accounts.acme)) return;

  // (a) The worked example from the documentation, mid-flight. The 18% on the
  // setup service is over its 10% Gold/Services ceiling, which is what routes
  // it to a manager and what the exception table on the approvals screen shows.
  const golden = await authorQuote({
    cast,
    rep: cast.priya,
    account: cast.accounts.acme,
    lines: [
      { sku: "HW-LAPTOP-PRO", quantity: 10, discount: "12.00" },
      { sku: "SV-SETUP", quantity: 1, discount: "18.00" },
    ],
  });
  await submitForApprovalAs(authz(cast.priya), golden.id);
  await shareWithCustomerAs(authz(cast.priya), golden.id);
  log("Acme", `${golden.quoteNumber} over ceiling, with the manager, shared (risk ${golden.riskScore})`);

  // (b) A working draft nobody outside the building has seen, carrying an
  // upsell that was taken and one that was waved away. Both statuses matter:
  // accept/dismiss is what makes the suggestion measurable rather than a
  // decoration on the screen.
  const draft = await authorQuote({
    cast,
    rep: cast.priya,
    account: cast.accounts.acme,
    lines: [
      { sku: "HW-LAPTOP-PRO", quantity: 2, discount: "8.00" },
      { sku: "SV-ONBOARD", quantity: 1, discount: "5.00" },
    ],
  });
  const suggestions = await getUpsellSuggestions(draft.id);
  if (suggestions.length > 0) {
    await acceptUpsell({
      quotationId: draft.id,
      productId: suggestions[0].productId,
      actorId: cast.priya.id,
    });
  }
  if (suggestions.length > 1) {
    await dismissUpsell({ quotationId: draft.id, productId: suggestions[1].productId });
  }
  log("Acme", `${draft.quoteNumber} internal draft, ${suggestions.length} upsell(s) suggested`);

  // (c) The full journey, end to end: approved without a reviewer because
  // nothing breaches a ceiling, confirmed by the customer, billed both ways -
  // one-time lines on an invoice and the support subscription on a schedule -
  // paid, allocated, shipped and delivered when promised.
  const order = await authorQuote({
    cast,
    rep: cast.priya,
    account: cast.accounts.acme,
    lines: [
      { sku: "HW-LAPTOP-PRO", quantity: 10, discount: "12.00" },
      { sku: "SV-SETUP", quantity: 1, discount: "10.00" },
      { sku: "SUB-SUPPORT", quantity: 3 },
    ],
  });
  await submitForApprovalAs(authz(cast.priya), order.id);
  await shareWithCustomerAs(authz(cast.priya), order.id);
  expectOk(
    await confirmPortalQuotation({ user: authz(cast.buyers.acme), quotationId: order.id }),
    `Acme confirming ${order.quoteNumber}`,
  );

  const billed = await issueBillingAs(authz(cast.farid), order.id);
  if (billed.invoiceId) {
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: billed.invoiceId } });
    await setPaymentTerms({
      invoiceId: invoice.id,
      issuedDaysAgo: 12,
      netDays: 30,
      actor: cast.farid,
    });
    // Settled in one go, so the ledger has a PAID row to sit beside the
    // part-paid and the overdue ones. `recordPayment` derives the status from
    // the amounts rather than taking it from the caller.
    await recordPaymentAs(authz(cast.farid), {
      invoiceId: invoice.id,
      amount: invoice.dueAmount.toFixed(2),
      method: "BANK_TRANSFER",
      reference: "NEFT/ACME/0091",
    });
  }

  await allocateFulfillment({ quotationId: order.id, user: authz(cast.farid) });
  const shipment = await dispatchShipmentAs(authz(cast.farid), {
    quotationId: order.id,
    warehouseId: cast.depot("MAIN"),
    estimatedDeliveryDate: daysFromNow(-2),
  });
  // Arrived a day before it was promised, which is the control case: the
  // slippage indicator has to stay quiet for an order that behaved.
  await recordDeliveryAs(authz(cast.farid), {
    shipmentId: shipment.shipmentId,
    deliveredAt: daysFromNow(-3),
  });
  log("Acme", `${order.quoteNumber} confirmed, invoiced, paid, delivered on time`);
}

/**
 * Beta - the customer who negotiates, and the customer who asks.
 *
 * Two threads rather than one, because they demonstrate different halves of the
 * engine. The first is three counter-discounts, each judged against the last
 * approved snapshot and each pulling the quote back into review; by the third
 * round the repeated-negotiation penalty is capped and the deal is visibly
 * costing more to close than it is worth. The second is a plain question left
 * unanswered, which is what an inbox needs to look like.
 */
async function tellBeta(cast: Cast, ledger: Ledger): Promise<void> {
  note(ledger, "Three counter-discount rounds, each re-approved against the snapshot", "Negotiation");
  note(ledger, "A customer question still awaiting a reply", "Negotiation");
  note(ledger, "Comments from both sides on one thread", "Negotiation, Portal");

  if (await alreadyTold(cast.accounts.beta)) return;

  const deal = await authorQuote({
    cast,
    rep: cast.rahul,
    account: cast.accounts.beta,
    lines: [
      { sku: "HW-LAPTOP-PRO", quantity: 6, discount: "8.00" },
      { sku: "SUB-SUPPORT", quantity: 1, discount: "5.00" },
    ],
  });
  await submitForApprovalAs(authz(cast.rahul), deal.id);
  await shareWithCustomerAs(authz(cast.rahul), deal.id);
  await markSent(deal.id, cast.rahul);

  const laptopLine = await prisma.quotationLine.findFirstOrThrow({
    where: { quotationId: deal.id },
    orderBy: { sequence: "asc" },
    select: { id: true },
  });

  // Each round asks for more than the round before, so the what-if finds a line
  // discounted beyond what was approved and forces a fresh decision every time.
  // The manager keeps saying yes, which is the honest version of this story:
  // the governance trail is what makes the concession visible afterwards, not
  // something that stopped it happening.
  const rounds = [
    { ask: "13.00", because: "Two other vendors have come in under you on the hardware." },
    { ask: "15.00", because: "Our board signed off a lower number than this." },
    { ask: "17.00", because: "Final ask - 17% and we place the order this week." },
  ];
  for (const round of rounds) {
    expectOk(
      await submitNegotiation({
        user: authz(cast.buyers.beta),
        quotationId: deal.id,
        requestType: "COUNTER_DISCOUNT",
        lineId: laptopLine.id,
        requestedValue: round.ask,
        reason: round.because,
      }),
      `Beta countering at ${round.ask}%`,
    );
    await decide({
      quotationId: deal.id,
      reviewer: cast.meera,
      decision: "APPROVE",
      reason: `Concession approved to hold the account at ${round.ask}%`,
    });
  }

  // A closing remark from the buyer, which is what puts a customer-authored
  // comment on the thread - a counter-discount records terms, not words.
  expectOk(
    await submitNegotiation({
      user: authz(cast.buyers.beta),
      quotationId: deal.id,
      requestType: "OTHER",
      reason: "Please confirm the revised sheet and we will raise the PO on Monday.",
    }),
    "Beta closing remark",
  );
  await sellerReply({
    quotationId: deal.id,
    author: cast.rahul,
    message: "Revised sheet attached at 17%. Holding stock for you until Friday.",
  });

  ledger.aged.push({
    quotationId: deal.id,
    quoteNumber: deal.quoteNumber,
    inactiveDays: 4,
  });
  log("Beta", `${deal.quoteNumber} three rounds settled at 17%, thread has both sides`);

  // Deliberately never submitted for approval. A rep often sends a sheet over
  // for comment before finalising it, and that is the only shape in which the
  // portal's `awaitingSellerReview` can be true: an open thread on a quote that
  // is not yet approved. Submit this one and the flag reads false, which would
  // make the screen say nobody is waiting while a question sits unanswered.
  const question = await authorQuote({
    cast,
    rep: cast.rahul,
    account: cast.accounts.beta,
    lines: [{ sku: "HW-WARRANTY-EXT", quantity: 3 }],
  });
  await shareWithCustomerAs(authz(cast.rahul), question.id);
  await markSent(question.id, cast.rahul);
  expectOk(
    await submitNegotiation({
      user: authz(cast.buyers.beta),
      quotationId: question.id,
      requestType: "QUESTION",
      reason: "Does the extended warranty cover on-site replacement, or return to base?",
    }),
    "Beta question",
  );
  log("Beta", `${question.quoteNumber} customer question, unanswered`);
}

/**
 * Cobalt - the two decisions that are not approval.
 *
 * A demo database full of approvals proves only that the happy path works. A
 * rejection and a return are the states with a CHECK constraint behind them:
 * neither can be written without a reason, in the service and again in the
 * database, because §A3 asks for every decision to be logged with a user, a
 * timestamp and a reason, and a rejection nobody has to justify is exactly the
 * record that makes an audit trail worthless.
 */
async function tellCobalt(cast: Cast, ledger: Ledger): Promise<void> {
  note(ledger, "A rejected quotation, with the reviewer's reason on the record", "Approvals");
  note(ledger, "A returned quotation waiting for the rep to re-quote it", "Approvals, Sales Workspace");

  if (await alreadyTold(cast.accounts.cobalt)) return;

  const rejected = await authorQuote({
    cast,
    rep: cast.priya,
    account: cast.accounts.cobalt,
    lines: [{ sku: "SV-ONBOARD", quantity: 2, discount: "14.00" }],
  });
  await submitForApprovalAs(authz(cast.priya), rejected.id);
  await decide({
    quotationId: rejected.id,
    reviewer: cast.meera,
    decision: "REJECT",
    reason: "14% on Bronze services is nearly three times the ceiling and the margin does not carry it.",
  });
  log("Cobalt", `${rejected.quoteNumber} rejected by the manager`);

  const returned = await authorQuote({
    cast,
    rep: cast.priya,
    account: cast.accounts.cobalt,
    lines: [{ sku: "SV-SETUP", quantity: 1, discount: "9.00" }],
  });
  await submitForApprovalAs(authz(cast.priya), returned.id);
  await decide({
    quotationId: returned.id,
    reviewer: cast.meera,
    decision: "RETURN",
    reason: "Close, but re-quote at the 5% ceiling and I will sign it the same day.",
  });
  log("Cobalt", `${returned.quoteNumber} returned to Priya for a re-quote`);
}

/**
 * Halcyon - the receivable that is only half collected.
 *
 * The other orders here are either paid or unpaid, and both are easy. This one
 * is the case a finance screen actually spends its day on: two payments by two
 * different methods against one invoice, neither of them closing it. It also
 * carries the delivery that arrived late, which is what the slippage indicator
 * compares a promise against.
 */
async function tellHalcyon(cast: Cast, ledger: Ledger): Promise<void> {
  note(ledger, "An invoice part-paid by two methods, still owing", "Billing");
  note(ledger, "A quantity change the seller declined", "Negotiation");
  note(ledger, "A delivery that arrived five days after it was promised", "Fulfillment");

  if (await alreadyTold(cast.accounts.halcyon)) return;

  const order = await authorQuote({
    cast,
    rep: cast.priya,
    account: cast.accounts.halcyon,
    lines: [
      { sku: "HW-LAPTOP-PRO", quantity: 4, discount: "9.00" },
      { sku: "SV-SETUP", quantity: 1, discount: "7.00" },
    ],
  });
  await submitForApprovalAs(authz(cast.priya), order.id);
  await shareWithCustomerAs(authz(cast.priya), order.id);
  await markSent(order.id, cast.priya);

  // A quantity change touches no discount, so it is recorded and left for a
  // human rather than re-evaluated - which is why it stays SUBMITTED until
  // somebody answers it.
  const asked = expectOk(
    await submitNegotiation({
      user: authz(cast.buyers.halcyon),
      quotationId: order.id,
      requestType: "QUANTITY_CHANGE",
      requestedValue: "8",
      reason: "Could we take eight units at the same rate?",
    }),
    "Halcyon quantity change",
  );
  await sellerReply({
    quotationId: order.id,
    author: cast.priya,
    message: "We can hold 9% at four units. Eight would need a fresh approval and a longer lead time.",
  });
  if ("requestId" in asked) {
    await declineNegotiationRequest({
      requestId: asked.requestId,
      quotationId: order.id,
      decider: cast.priya,
      reason: "Quantity change declined - the rate does not survive the volume",
    });
  }

  expectOk(
    await confirmPortalQuotation({ user: authz(cast.buyers.halcyon), quotationId: order.id }),
    `Halcyon confirming ${order.quoteNumber}`,
  );

  const billed = await issueBillingAs(authz(cast.farid), order.id);
  if (billed.invoiceId) {
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: billed.invoiceId } });
    await setPaymentTerms({
      invoiceId: invoice.id,
      issuedDaysAgo: 9,
      netDays: 30,
      actor: cast.farid,
    });
    // Fractions of the total, computed as Decimals. Parsing money into a
    // JavaScript number to take 40% of it is the exact mistake D2 exists to
    // prevent, and it is no more acceptable in a seed than in the engine.
    const half = invoice.total.times("0.40").toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const quarter = invoice.total.times("0.25").toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    await recordPaymentAs(authz(cast.farid), {
      invoiceId: invoice.id,
      amount: half.toFixed(2),
      method: "CHEQUE",
      reference: "CHQ 448121",
    });
    await recordPaymentAs(authz(cast.farid), {
      invoiceId: invoice.id,
      amount: quarter.toFixed(2),
      method: "CARD",
      reference: "auth 7X21QD",
    });
  }

  await allocateFulfillment({ quotationId: order.id, user: authz(cast.farid) });
  const shipment = await dispatchShipmentAs(authz(cast.farid), {
    quotationId: order.id,
    warehouseId: cast.depot("MAIN"),
    estimatedDeliveryDate: daysFromNow(-8),
  });
  await recordDeliveryAs(authz(cast.farid), {
    shipmentId: shipment.shipmentId,
    deliveredAt: daysFromNow(-3),
  });
  log("Halcyon", `${order.quoteNumber} 65% collected, delivered five days late`);
}

/**
 * Northwind - the quote that needs two desks.
 *
 * The approval chain has two configured steps and almost nothing ever reaches
 * the second one, so PENDING_FINANCE is the state most likely to have never
 * been seen working. This quote earns it honestly: two service lines discounted
 * far past their Gold ceiling, a blended margin that has gone negative, and a
 * risk score high enough that the manager's signature is only the first of two.
 *
 * It is left sitting on Finance deliberately. Farid's queue should not be empty
 * when a reviewer signs in as him.
 */
async function tellNorthwind(cast: Cast, ledger: Ledger): Promise<void> {
  note(ledger, "A quote through the manager and now with Finance", "Approvals (sign in as Farid)");
  note(ledger, "A risk score in the high band, itemised by contributor", "Approvals, Deal Health");

  if (await alreadyTold(cast.accounts.northwind)) return;

  const deal = await authorQuote({
    cast,
    rep: cast.rahul,
    account: cast.accounts.northwind,
    lines: [
      { sku: "SV-SETUP", quantity: 1, discount: "40.00" },
      { sku: "SV-ONBOARD", quantity: 1, discount: "35.00" },
    ],
  });
  await submitForApprovalAs(authz(cast.rahul), deal.id);
  await decide({
    quotationId: deal.id,
    reviewer: cast.meera,
    decision: "APPROVE",
    reason: "Strategic account, but the margin is under water - Finance has to see this one.",
  });

  ledger.aged.push({
    quotationId: deal.id,
    quoteNumber: deal.quoteNumber,
    inactiveDays: 3,
    pendingDays: 3,
  });
  log(
    "Northwind",
    `${deal.quoteNumber} risk ${deal.riskScore}, margin ${deal.marginPercentage.toFixed(2)}%, now with Finance`,
  );
}

/**
 * Meridian - the counter that changed nothing, and stock waiting to leave.
 *
 * Not every customer request needs a human. This buyer asks for *less* than was
 * approved in exchange for a faster ship, and the what-if says so: the proposal
 * stays inside terms a manager already signed, so it is applied on the spot and
 * nobody is interrupted. That outcome is far harder to believe without seeing
 * it than the one that escalates.
 *
 * The order then sits allocated but undispatched, which is what the fulfilment
 * queue is for.
 */
async function tellMeridian(cast: Cast, ledger: Ledger): Promise<void> {
  note(ledger, "A counter-discount applied with no re-approval needed", "Negotiation");
  note(ledger, "An annual subscription alongside one-time lines on one order", "Billing");
  note(ledger, "An overdue invoice nobody has paid", "Billing");
  note(ledger, "Reserved stock waiting for someone to dispatch it", "Fulfillment");

  if (await alreadyTold(cast.accounts.meridian)) return;

  const order = await authorQuote({
    cast,
    rep: cast.divya,
    account: cast.accounts.meridian,
    lines: [
      { sku: "HW-LAPTOP-PRO", quantity: 6, discount: "14.00" },
      { sku: "HW-WARRANTY-EXT", quantity: 2 },
      { sku: "SUB-PLATFORM", quantity: 1 },
    ],
  });
  await submitForApprovalAs(authz(cast.divya), order.id);
  await shareWithCustomerAs(authz(cast.divya), order.id);

  const laptopLine = await prisma.quotationLine.findFirstOrThrow({
    where: { quotationId: order.id },
    orderBy: { sequence: "asc" },
    select: { id: true },
  });
  expectOk(
    await submitNegotiation({
      user: authz(cast.buyers.meridian),
      quotationId: order.id,
      requestType: "COUNTER_DISCOUNT",
      lineId: laptopLine.id,
      requestedValue: "12.00",
      reason: "We will settle at 12% if you can ship inside the week.",
    }),
    "Meridian counter",
  );
  await sellerReply({
    quotationId: order.id,
    author: cast.divya,
    message: "Done - 12% and it leaves the depot this week.",
  });

  expectOk(
    await confirmPortalQuotation({ user: authz(cast.buyers.meridian), quotationId: order.id }),
    `Meridian confirming ${order.quoteNumber}`,
  );

  const billed = await issueBillingAs(authz(cast.farid), order.id);
  if (billed.invoiceId) {
    // Issued six weeks ago on net 30, so it is fifteen days past due and the
    // receivables view has an ageing bucket with something in it.
    await setPaymentTerms({
      invoiceId: billed.invoiceId,
      issuedDaysAgo: 45,
      netDays: 30,
      actor: cast.farid,
    });
  }

  // The advisory pre-flight first, then the authoritative allocation. They are
  // separate on purpose (D4): the plan reserves nothing and can go stale, and
  // the variance between the two is what the fulfilment screen reports.
  await planFulfillment(order.id);
  await allocateFulfillment({ quotationId: order.id, user: authz(cast.farid) });
  log("Meridian", `${order.quoteNumber} counter applied without re-approval, stock reserved`);
}

/**
 * Vertex - the deal that has gone wrong in four different ways at once.
 *
 * The health engine adds five independent penalties, and a demo with one
 * unhealthy deal usually only exercises one of them. This deal is stalled,
 * has been round the negotiation loop twice, is discounted well above what its
 * rep normally gives, and is sitting on an open backorder. Together that is a
 * CRITICAL score with an itemised reason, which is the difference between a
 * dashboard and a red badge.
 *
 * Its allocation is a manual override: an operator shipped what East could
 * cover today rather than waiting for the full fifteen, and the audit entry
 * carries both the split the system recommended and the one they chose.
 */
async function tellVertex(cast: Cast, ledger: Ledger): Promise<void> {
  note(ledger, "A CRITICAL deal with every health penalty itemised", "Deal Health");
  note(ledger, "A manual allocation override, recorded against the recommendation", "Fulfillment");
  note(ledger, "An open backorder for the units stock could not cover", "Fulfillment");

  if (await alreadyTold(cast.accounts.vertex)) return;

  const deal = await authorQuote({
    cast,
    rep: cast.divya,
    account: cast.accounts.vertex,
    lines: [
      { sku: "HW-LAPTOP-PRO", quantity: 15, discount: "14.00" },
      { sku: "SV-SETUP", quantity: 1, discount: "16.00" },
    ],
  });
  await submitForApprovalAs(authz(cast.divya), deal.id);
  await decide({
    quotationId: deal.id,
    reviewer: cast.arjun,
    decision: "APPROVE",
    reason: "Volume justifies it at 14%.",
  });
  await shareWithCustomerAs(authz(cast.divya), deal.id);
  await markSent(deal.id, cast.divya);

  const laptopLine = await prisma.quotationLine.findFirstOrThrow({
    where: { quotationId: deal.id },
    orderBy: { sequence: "asc" },
    select: { id: true },
  });
  for (const ask of ["16.00", "18.00"]) {
    expectOk(
      await submitNegotiation({
        user: authz(cast.buyers.vertex),
        quotationId: deal.id,
        requestType: "COUNTER_DISCOUNT",
        lineId: laptopLine.id,
        requestedValue: ask,
        reason: `Procurement will only release the PO at ${ask}%.`,
      }),
      `Vertex countering at ${ask}%`,
    );
    await decide({
      quotationId: deal.id,
      reviewer: cast.arjun,
      decision: "APPROVE",
      reason: `Conceded to ${ask}% to keep the account.`,
    });
  }

  await planFulfillment(deal.id);

  const setupLine = await prisma.quotationLine.findFirstOrThrow({
    where: { quotationId: deal.id },
    orderBy: { sequence: "desc" },
    select: { id: true },
  });
  // Eight laptops out of East and the service from Main - two shipments where
  // the plan wanted one, and seven units short, which becomes an open
  // backorder rather than a silently truncated order.
  await overrideAllocation({
    quotationId: deal.id,
    user: authz(cast.farid),
    picks: [
      { lineId: laptopLine.id, warehouseId: cast.depot("EAST"), quantity: 8 },
      { lineId: setupLine.id, warehouseId: cast.depot("MAIN"), quantity: 1 },
    ],
    reason: "Customer needs the first eight this week; the balance follows on restock.",
  });

  ledger.aged.push({
    quotationId: deal.id,
    quoteNumber: deal.quoteNumber,
    inactiveDays: 10,
  });
  log("Vertex", `${deal.quoteNumber} overridden split, 7 units backordered, two rounds conceded`);
}

/**
 * Sierra - the quote nobody has looked at.
 *
 * The most useful thing a health dashboard does is name a human bottleneck, and
 * this is the only shape that produces one: a quote submitted five days ago and
 * untouched for ten. The engine deliberately ranks that above a larger delivery
 * penalty, because chasing a warehouse does not unstick an unread approval.
 */
async function tellSierra(cast: Cast, ledger: Ledger): Promise<void> {
  note(ledger, "A quote stuck in review, escalated by its manager", "Deal Health, Approvals");

  if (await alreadyTold(cast.accounts.sierra)) return;

  const deal = await authorQuote({
    cast,
    rep: cast.sanjay,
    account: cast.accounts.sierra,
    lines: [{ sku: "HW-LAPTOP-PRO", quantity: 8, discount: "9.00" }],
  });
  await submitForApprovalAs(authz(cast.sanjay), deal.id);

  ledger.aged.push({
    quotationId: deal.id,
    quoteNumber: deal.quoteNumber,
    inactiveDays: 10,
    pendingDays: 5,
  });

  // A second, unremarkable draft on the same account. Every other rep here owns
  // deals at three or more stages, and a rep whose whole book is two extremes
  // makes the pipeline board look staged rather than scoped.
  const drafting = await authorQuote({
    cast,
    rep: cast.sanjay,
    account: cast.accounts.sierra,
    lines: [
      { sku: "SV-ONBOARD", quantity: 1, discount: "4.00" },
      { sku: "HW-WARRANTY-EXT", quantity: 2 },
    ],
  });

  log("Sierra", `${deal.quoteNumber} forgotten in review, ${drafting.quoteNumber} still being written`);
}

/**
 * Quarry Hill - goods on the road, already past their promise.
 *
 * Slippage has two shapes and only one of them is obvious. A late arrival is
 * visible after the fact; a shipment that has *not* arrived and is already past
 * its promised date is the one a manager wants told to them, and it is the only
 * shape that reaches the health board, because that board reads deals still in
 * flight rather than orders already closed.
 */
async function tellQuarryHill(cast: Cast, ledger: Ledger): Promise<void> {
  note(ledger, "A dispatched shipment already past its promised date", "Fulfillment, Deal Health");

  if (await alreadyTold(cast.accounts.quarry)) return;

  const order = await authorQuote({
    cast,
    rep: cast.sanjay,
    account: cast.accounts.quarry,
    lines: [
      { sku: "HW-LAPTOP-PRO", quantity: 5, discount: "10.00" },
      { sku: "HW-WARRANTY-EXT", quantity: 1 },
    ],
  });
  await submitForApprovalAs(authz(cast.sanjay), order.id);
  await shareWithCustomerAs(authz(cast.sanjay), order.id);
  await markSent(order.id, cast.sanjay);

  await allocateFulfillment({ quotationId: order.id, user: authz(cast.farid) });
  await dispatchShipmentAs(authz(cast.farid), {
    quotationId: order.id,
    warehouseId: cast.depot("MAIN"),
    estimatedDeliveryDate: daysFromNow(-3),
  });

  ledger.aged.push({
    quotationId: order.id,
    quoteNumber: order.quoteNumber,
    inactiveDays: 7,
  });
  log("Quarry Hill", `${order.quoteNumber} in transit, three days past its promise`);
}

/**
 * Lumen - the account that churned.
 *
 * Every other account here is growing. This one leaves, and the leaving is what
 * exercises the parts of billing nobody demos: a subscription cancelled part
 * way through a period it has already been invoiced for, the pro-rata credit
 * note that answers for it, a quotation that never went anywhere, and finally
 * an account closed rather than deleted because it has history.
 *
 * The cancellation itself happens after the billing run, in `runTheBillingCycle`
 * - there is no credit to issue against a period nobody has been charged for.
 */
async function tellLumen(cast: Cast, ledger: Ledger): Promise<void> {
  note(ledger, "A subscription cancelled mid-period, answered by a credit note", "Billing");
  note(ledger, "A cancelled quotation and a closed account", "Sales Workspace, Accounts");

  if (await alreadyTold(cast.accounts.lumen)) return;

  const order = await authorQuote({
    cast,
    rep: cast.divya,
    account: cast.accounts.lumen,
    lines: [{ sku: "SUB-SUPPORT", quantity: 5 }],
  });
  await submitForApprovalAs(authz(cast.divya), order.id);
  await shareWithCustomerAs(authz(cast.divya), order.id);
  expectOk(
    await confirmPortalQuotation({ user: authz(cast.buyers.lumen), quotationId: order.id }),
    `Lumen confirming ${order.quoteNumber}`,
  );
  // Every line is recurring, so this raises no one-time invoice at all - which
  // is the case that proves the two billing logics really are independent.
  await issueBillingAs(authz(cast.farid), order.id);

  // Written while the account is still ACTIVE and still has a tier. Both are
  // checked at creation, in the service and again by a database trigger, so the
  // order of these last three steps is not stylistic.
  const walkedAway = await authorQuote({
    cast,
    rep: cast.divya,
    account: cast.accounts.lumen,
    lines: [{ sku: "SV-ONBOARD", quantity: 2, discount: "9.00" }],
  });
  await markCancelled(walkedAway.id, cast.divya, "Customer is winding the site down; no longer proceeding.");

  log("Lumen", `${order.quoteNumber} subscribed, ${walkedAway.quoteNumber} cancelled`);
}

// ---------------------------------------------------------------------------
// 6. The billing cycle, run once across everything
// ---------------------------------------------------------------------------

/**
 * Invoice every schedule entry that has come due, then let one customer leave.
 *
 * A sweep rather than a per-account act, which is why it does not sit inside a
 * story: `runBilling` looks at every subscription in the system and bills the
 * periods that have arrived. Running it here means the first period of every
 * subscription this seed created is genuinely invoiced, so the billing screen
 * shows issued documents rather than a schedule of intentions.
 *
 * Lumen's cancellation follows immediately, because a pro-rata credit is owed
 * only against a period that was actually charged - cancel first and the credit
 * is correctly zero, which is a true answer to a question nobody asked.
 */
async function runTheBillingCycle(cast: Cast): Promise<void> {
  const run = await runBillingAs(authz(cast.farid));
  log("billing run", `${run.invoicesCreated} invoice(s) raised from ${run.entriesInvoiced} due period(s)`);

  // Found by account and state rather than remembered from the story, so this
  // is a no-op on a second run: once the subscription is CANCELLED there is
  // nothing here to match, and nothing to credit twice.
  const subscription = await prisma.subscription.findFirst({
    where: { customerId: cast.accounts.lumen.id, status: "ACTIVE" },
    select: { id: true },
  });
  if (!subscription) return;

  const credited = await cancelSubscription({
    subscriptionId: subscription.id,
    user: authz(cast.farid),
    reason: "Customer closing the site at the end of the quarter.",
  });
  log(
    "credit note",
    credited.creditNoteId
      ? `${credited.creditAmount.toFixed(2)} credited for the unused part of the period`
      : "nothing to credit - the period had not been invoiced",
  );

  await deactivateAccount(
    cast.accounts.lumen,
    cast.ada,
    "Site closed; account retained for its billing history.",
  );
}

// ---------------------------------------------------------------------------
// 7. Health, alerts and the two that get closed
// ---------------------------------------------------------------------------

/**
 * Score every live deal, then act on two of the alerts.
 *
 * Health is computed on a schedule and never on write, so without this pass the
 * board is empty however many deals exist. Everything it raises is a
 * consequence of state written above - nothing here decides that a deal is
 * unhealthy, it only asks.
 *
 * Two alerts are then closed by the manager who owns them, and one deal is
 * escalated by hand. Resolution matters as much as raising: a board where
 * nothing has ever been dealt with does not show that dealing with things is
 * possible, and `resolveAlertAs` is the call that checks the closer can see the
 * deal the alert is on - a manager cannot tidy away the other team's warnings.
 */
async function scoreAndTriage(cast: Cast): Promise<void> {
  const scored = await recomputeAllDealHealth();
  log("health", `${scored.scored} live deal(s) scored`);

  // The one quote sitting unread on a reviewer. Located by its state rather
  // than by an id carried down from the story, so it is still found on a run
  // that had nothing to build. `escalateDeal` is idempotent by design: it
  // adopts the alert scoring already raised rather than stacking a second one.
  const stuck = await prisma.quotation.findFirst({
    where: { customerId: cast.accounts.sierra.id, approvalState: "PENDING_MANAGER" },
    select: { id: true },
  });
  if (stuck) {
    await escalateDeal({
      quotationId: stuck.id,
      user: authz(cast.arjun),
      note: "Five days on my desk with no decision - picking this up personally.",
    });
  }

  // Closed by the manager whose team owns each deal: Beta is North, Quarry Hill
  // is South. Swapping them would be refused, which is the rule doing its job -
  // `resolveAlertAs` asks whether the closer can see the deal the alert is on,
  // not merely whether their role closes alerts in general.
  const closable: { account: Account; type: "DISCOUNT_ANOMALY" | "DELIVERY_SLIPPAGE"; by: Person }[] = [
    { account: cast.accounts.beta, type: "DISCOUNT_ANOMALY", by: cast.meera },
    { account: cast.accounts.quarry, type: "DELIVERY_SLIPPAGE", by: cast.arjun },
  ];

  let resolved = 0;
  for (const entry of closable) {
    const alert = await prisma.dealAlert.findFirst({
      where: {
        quotation: { customerId: entry.account.id },
        type: entry.type,
        status: "OPEN",
      },
      select: { id: true },
    });
    if (!alert) continue;
    await resolveAlertAs(authz(entry.by), alert.id);
    resolved += 1;
  }

  const open = await prisma.dealAlert.count({ where: { status: "OPEN" } });
  log("alerts", `${open} open, ${resolved} resolved by the owning manager`);
}

// ---------------------------------------------------------------------------
// 8. The summary a reviewer actually reads
// ---------------------------------------------------------------------------

/**
 * Print who to sign in as, what each of them will see, and where to look.
 *
 * The per-role counts are not decoration: they are the demonstration. They come
 * from `listQuotations`, which is the same call the pipeline board makes, so
 * the numbers below are the rows those people genuinely get - not a claim about
 * scoping but a measurement of it.
 */
async function report(cast: Cast, ledger: Ledger): Promise<void> {
  // Names and roles come off the seeded rows rather than being retyped here, so
  // this table cannot quietly describe a database it no longer matches.
  const signIns: { person: Person; team: string }[] = [
    { person: cast.ada, team: "-" },
    { person: cast.meera, team: "North" },
    { person: cast.arjun, team: "South" },
    { person: cast.priya, team: "North" },
    { person: cast.rahul, team: "North" },
    { person: cast.divya, team: "South" },
    { person: cast.sanjay, team: "South" },
    { person: cast.farid, team: "-" },
  ];

  heading("Sign in with the password " + PASSWORD);
  console.table(
    signIns.map(({ person, team }) => ({
      role: person.role ?? person.kind,
      who: person.name,
      email: person.email,
      team,
    })),
  );

  heading("What each identity can see");
  const rows: Record<string, string | number>[] = [];
  for (const { person, team } of signIns) {
    const label = `${person.name.split(" ")[0]} (${person.role}${team === "-" ? "" : `, ${team}`})`;
    const visible = await listQuotations(authz(person));
    const live = visible.filter((q) => !q.quoteNumber.startsWith(HISTORY_PREFIX));
    rows.push({
      identity: label,
      deals: visible.length,
      "in flight": live.length,
      accounts: [...new Set(live.map((q) => q.customerName))].sort().join(", ") || "-",
    });
  }
  console.table(rows);

  heading("What each buyer can see in the portal");
  const portalRows: Record<string, string | number>[] = [];
  for (const buyer of Object.values(cast.buyers)) {
    // The portal's own list, so this summary reports exactly what the buyer
    // will see on /my/quotations rather than an internal approximation of it.
    const visible = await listMyQuotations(authz(buyer));
    const quotations = visible.status === 200 ? visible.quotations : [];
    portalRows.push({
      buyer: buyer.email,
      "shared quotations": quotations.length,
      "awaiting our reply": quotations.filter((q) => q.awaitingSellerReview).length,
      confirmed: quotations.filter((q) => q.status === "Confirmed").length,
    });
  }
  console.table(portalRows);

  heading("Where to look");
  for (const scenario of ledger.scenarios) {
    console.log(`  ${scenario.shows.padEnd(62)} ${scenario.screen}`);
  }

  // A count per enum member, because the claim this seed makes is coverage and
  // a claim about coverage should be checkable in one glance.
  heading("Coverage");
  const [byStatus, byApproval, byPortal, byRequest, byAlert, bySeverity] = await Promise.all([
    prisma.quotation.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.quotation.groupBy({ by: ["approvalState"], _count: { _all: true } }),
    prisma.quotation.groupBy({ by: ["portalStatus"], _count: { _all: true } }),
    prisma.negotiationRequest.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.dealAlert.groupBy({ by: ["type"], _count: { _all: true } }),
    prisma.dealHealthSnapshot.groupBy({ by: ["severity"], _count: { _all: true } }),
  ]);

  const line = (label: string, entries: { _count: { _all: number } }[], keys: string[]) =>
    console.log(`  ${label.padEnd(20)}${keys.map((k, i) => `${k} ${entries[i]._count._all}`).join("  ")}`);

  line("quotation status", byStatus, byStatus.map((r) => r.status));
  line("approval state", byApproval, byApproval.map((r) => r.approvalState));
  line("portal status", byPortal, byPortal.map((r) => r.portalStatus));
  line("negotiations", byRequest, byRequest.map((r) => r.status));
  line("alerts", byAlert, byAlert.map((r) => r.type));
  line("health severity", bySeverity, bySeverity.map((r) => r.severity));

  const [invoices, payments, subscriptions, creditNotes, allocations, backorders, shipments, lowStock] =
    await Promise.all([
      prisma.invoice.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.payment.groupBy({ by: ["method"], _count: { _all: true } }),
      prisma.subscription.count(),
      prisma.creditNote.count(),
      prisma.fulfillmentAllocation.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.backorder.count({ where: { status: "OPEN" } }),
      prisma.shipment.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*)::bigint AS "n"
          FROM "WarehouseStock"
         WHERE "reorderLevel" > 0
           AND "availableQuantity" - "reservedQuantity" <= "reorderLevel"
      `,
    ]);

  line("invoices", invoices, invoices.map((r) => r.status));
  line("payments", payments, payments.map((r) => r.method));
  line("allocations", allocations, allocations.map((r) => r.status));
  line("shipments", shipments, shipments.map((r) => r.status));
  console.log(
    `  ${"other".padEnd(20)}subscriptions ${subscriptions}  credit notes ${creditNotes}  ` +
      `open backorders ${backorders}  stock rows below reorder ${lowStock[0]?.n ?? 0n}`,
  );

  console.log("\n  Customers sign in by magic link: npm run portal:link\n");
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // D3 - the persisted demo offset has to be in the cache before anything reads
  // the clock, or half this seed is stamped with real time and half with
  // business time. Exactly as seed.ts does it, and for the same reason.
  await refreshClockOffset();

  console.log("\nDealFlow360 - showcase demo layer\n");

  const people = await seedPeople();
  const { accounts, buyers } = await seedAccounts(people);
  await seedAnnualPlan();

  // The cast is assembled in two stages because the network needs half of it:
  // stocking the new depot means naming products, so the SKU lookup has to
  // exist before `seedNetwork` runs and the warehouse lookup only after.
  //
  // Both are lookups that throw rather than maps that return undefined. A
  // mistyped SKU should stop the seed on the line that has the typo, not write
  // a quotation line against `undefined` and fail somewhere unrecognisable.
  const products = new Map<string, string>();
  for (const p of await prisma.product.findMany({ select: { id: true, sku: true } })) {
    products.set(p.sku, p.id);
  }
  const sku = (code: string): string => {
    const id = products.get(code);
    if (!id) throw new Error(`Product ${code} is missing. Run npm run db:seed first.`);
    return id;
  };

  const partial = { ...people, accounts, buyers, sku };
  const depots = await seedNetwork(partial);
  const depot = (code: string): string => {
    const id = depots.get(code);
    if (!id) throw new Error(`Warehouse ${code} is missing. Run npm run db:seed first.`);
    return id;
  };

  const cast: Cast = { ...partial, depot };
  const ledger: Ledger = { scenarios: [], aged: [] };

  heading("Building the accounts' stories");
  await tellAcme(cast, ledger);
  await tellBeta(cast, ledger);
  await tellCobalt(cast, ledger);
  await tellHalcyon(cast, ledger);
  await tellNorthwind(cast, ledger);
  await tellMeridian(cast, ledger);
  await tellVertex(cast, ledger);
  await tellSierra(cast, ledger);
  await tellQuarryHill(cast, ledger);
  await tellLumen(cast, ledger);

  heading("Settling the books and the board");
  await runTheBillingCycle(cast);
  // Ageing comes after every write and before scoring: everything above stamps
  // `lastActivityAt` forward, and everything below reads it.
  await ageTheBoard(ledger.aged);
  await scoreAndTriage(cast);

  note(ledger, "An account with no tier that cannot be quoted at all", "Sales Workspace (New Quotation)");
  note(ledger, "Stock rows sitting below their reorder point", "Settings (Replenishment)");
  note(ledger, "Two teams whose books do not overlap", "Sign in as Meera, then as Arjun");

  await report(cast, ledger);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
