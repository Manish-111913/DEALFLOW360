import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthzUser } from "../authz/roles";
import { ForbiddenError } from "../authz/roles";
import { prisma } from "../db";
import {
  createCustomerAs,
  createPortalUserAs,
  issuePortalLinkAs,
  listAccounts,
  listAssignableOwners,
} from "./account-admin";
import { assertCustomerCanBeQuoted } from "./customers";

/**
 * Creating accounts and provisioning portal access, with the caller checked.
 *
 * The three primitives underneath - createCustomer, createPortalUser,
 * issuePortalLink - were written for the seed to compose and check nothing at
 * all. `issuePortalLink` in particular mints a working credential from a
 * customer id, so the interesting cases here are the refusals.
 */

const PORTAL_ORIGIN = "http://localhost:3000";

let priya: AuthzUser;
let rahul: AuthzUser;
let manager: AuthzUser;
let finance: AuthzUser;
let buyer: AuthzUser;

const createdCustomers: string[] = [];
const createdUsers: string[] = [];

/**
 * Unique names and emails without reading a clock.
 *
 * D3 keeps every host-clock read in one module, and the structural test
 * enforces that across whole files - tests and comments included - so a
 * timestamp suffix is not available here. A counter is better anyway: the test
 * database is dropped and rebuilt for each run, so it is unique and
 * reproducible at once.
 */
let sequence = 0;
const unique = (prefix: string) => `${prefix}-${(sequence += 1)}`;

async function userFor(email: string): Promise<AuthzUser> {
  const f = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { id: f.id, kind: f.kind, role: f.role, customerId: f.customerId, salesTeamId: f.salesTeamId };
}

/** A uniquely named account, so reruns do not collide on Customer.name. */
async function accountFor(user: AuthzUser, suffix: string, ownerId?: string) {
  const customer = await createCustomerAs(user, {
    name: unique(`Test Account ${suffix}`),
    tier: "SILVER",
    accountOwnerId: ownerId,
  });
  createdCustomers.push(customer.id);
  return customer;
}

beforeAll(async () => {
  priya = await userFor("priya@dealflow360.test");
  rahul = await userFor("rahul@dealflow360.test");
  manager = await userFor("manager@dealflow360.test");
  finance = await userFor("finance@dealflow360.test");
  buyer = await userFor("buyer@acme.test");
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.portalAccessToken.deleteMany({ where: { customerId: { in: createdCustomers } } });
  await prisma.customer.deleteMany({ where: { id: { in: createdCustomers } } });
  await prisma.$disconnect();
});

describe("who may open an account", () => {
  it("gives the creating rep ownership", async () => {
    const customer = await accountFor(priya, "owned");
    expect(customer.assignedSalesRepId).toBe(priya.id);
  });

  it("refuses to let a rep put the account in someone else's book", async () => {
    // Honoured minus the part they may not do, the same way authoring a
    // quotation is: a rep quietly owning what they create is the outcome.
    const customer = await accountFor(priya, "reassigned", rahul.id);
    expect(customer.assignedSalesRepId).toBe(priya.id);
  });

  it("lets a manager assign the owner", async () => {
    const customer = await accountFor(manager, "assigned", rahul.id);
    expect(customer.assignedSalesRepId).toBe(rahul.id);
  });

  it("refuses Finance, which does not open accounts", async () => {
    await expect(
      createCustomerAs(finance, { name: unique("Finance Attempt"), tier: "GOLD" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a portal identity outright", async () => {
    await expect(
      createCustomerAs(buyer, { name: unique("Buyer Attempt"), tier: "GOLD" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a name that is already taken", async () => {
    const first = await accountFor(priya, "duplicate");
    await expect(
      createCustomerAs(priya, { name: first.name, tier: "SILVER" }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("produces an account that can actually be quoted", async () => {
    // The point of forcing a tier at creation: without one every discount
    // ceiling check downstream passes vacuously, so the account is unsellable.
    const customer = await accountFor(priya, "quotable");
    await expect(assertCustomerCanBeQuoted(customer.id)).resolves.toBeUndefined();
  });
});

describe("the owner dropdown", () => {
  it("is empty for a rep, who owns what they create", async () => {
    expect(await listAssignableOwners(priya)).toEqual([]);
  });

  it("offers a manager their own team", async () => {
    const owners = await listAssignableOwners(manager);
    expect(owners.length).toBeGreaterThan(0);
    expect(owners.map((o) => o.id)).toContain(priya.id);
  });
});

describe("provisioning portal access", () => {
  it("adds a contact and then issues a working link", async () => {
    const customer = await accountFor(priya, "portal");

    const contact = await createPortalUserAs(priya, {
      customerId: customer.id,
      email: `${unique("buyer")}@test.example`,
      name: "Test Buyer",
    });
    createdUsers.push(contact.id);
    expect(contact.kind).toBe("PORTAL");
    expect(contact.customerId).toBe(customer.id);

    const link = await issuePortalLinkAs(priya, customer.id, PORTAL_ORIGIN);
    expect(link.url).toContain(`${PORTAL_ORIGIN}/portal/login?token=`);

    // Only the hash is stored, so the token in that URL must not be findable.
    const raw = link.url.split("token=")[1];
    expect(await prisma.portalAccessToken.findFirst({ where: { tokenHash: raw } })).toBeNull();
  });

  it("refuses a link for an account nobody can sign in as", async () => {
    const customer = await accountFor(priya, "nocontact");
    await expect(issuePortalLinkAs(priya, customer.id, PORTAL_ORIGIN)).rejects.toThrow(
      /no portal contact/i,
    );
  });

  it("refuses a rep access to an account that is not theirs", async () => {
    const customer = await accountFor(manager, "othersbook", rahul.id);

    await expect(
      createPortalUserAs(priya, {
        customerId: customer.id,
        email: `${unique("intruder")}@test.example`,
        name: "Not Mine",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(issuePortalLinkAs(priya, customer.id, PORTAL_ORIGIN)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("lets the manager provision any account in the company", async () => {
    const customer = await accountFor(rahul, "managerreach");
    const contact = await createPortalUserAs(manager, {
      customerId: customer.id,
      email: `${unique("mgr")}@test.example`,
      name: "Manager Provisioned",
    });
    createdUsers.push(contact.id);
    expect(contact.customerId).toBe(customer.id);
  });

  it("refuses an email that already belongs to someone", async () => {
    const customer = await accountFor(priya, "clash");
    await expect(
      createPortalUserAs(priya, {
        customerId: customer.id,
        email: "buyer@acme.test",
        name: "Already Taken",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("the accounts list", () => {
  it("reports portal state and marks the caller's own accounts", async () => {
    const customer = await accountFor(priya, "listed");

    const rows = await listAccounts(priya);
    const row = rows.find((r) => r.id === customer.id);

    expect(row).toBeDefined();
    expect(row?.mine).toBe(true);
    expect(row?.portalUsers).toEqual([]);
    expect(row?.hasLiveLink).toBe(false);
    expect(row?.canGrantAccess).toBe(true);
  });

  it("tells a rep which accounts they may not provision", async () => {
    const customer = await accountFor(manager, "notmine", rahul.id);
    const row = (await listAccounts(priya)).find((r) => r.id === customer.id);

    // Visible - customer records are not scoped by owner - but not actionable,
    // and the list says so rather than letting the button 403.
    expect(row?.mine).toBe(false);
    expect(row?.canGrantAccess).toBe(false);
  });

  it("refuses a portal identity", async () => {
    await expect(listAccounts(buyer)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
