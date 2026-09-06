import type { CustomerTier } from "../generated/prisma/enums";
import type { AuthzUser } from "../authz/roles";
import { assertCan, ForbiddenError } from "../authz/roles";
import { scopeFor } from "../authz/scope";
import { issuePortalLink } from "../auth/portal-tokens";
import { createPortalUser } from "../auth/register";
import { currentBusinessTime } from "../clock";
import { prisma } from "../db";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { createCustomer } from "./customers";

/**
 * Customer accounts and the portal access granted against them.
 *
 * Three primitives sat here with no caller and no authorisation: `createCustomer`
 * takes an `actorId` for the audit trail but never asks who the actor is,
 * `createPortalUser` the same, and `issuePortalLink` mints a working credential
 * from a customer id alone. They were written to be composed by the seed, which
 * is why none of them checks anything - and because nothing else called them,
 * an account could only be created by re-running the seed.
 *
 * These are the wrappers the product uses. As in `quotation-authoring.ts`, the
 * primitives keep their signatures so the seed and the tests still compose them.
 */

// ---------------------------------------------------------------------------
// Who may do what here
// ---------------------------------------------------------------------------

/**
 * Provisioning portal access is not the same act as creating a record.
 *
 * A portal link is a working credential: whoever holds it reads that customer's
 * shared quotations. The capability matrix has no subject for this - it predates
 * the portal being administered from the product at all - so rather than
 * quietly widening `create`, the rule is written out here where it can be read:
 * the account's own rep, their manager, or an admin. A rep cannot hand out
 * access to an account that is not theirs.
 */
function mayGrantPortalAccess(user: AuthzUser, accountOwnerId: string | null): boolean {
  if (user.kind !== "INTERNAL") return false;
  if (user.role === "ADMIN" || user.role === "SALES_MANAGER") return true;
  return user.role === "SALES_REP" && accountOwnerId === user.id;
}

/** Only a manager or an admin hands an account to someone else. */
function mayAssignOwner(user: AuthzUser): boolean {
  return user.role === "SALES_MANAGER" || user.role === "ADMIN";
}

async function loadAccount(user: AuthzUser, customerId: string) {
  const scope = scopeFor(user, "Customer");
  const customer = await prisma.customer.findFirst({
    where: { AND: [{ id: customerId }, scope] },
    select: { id: true, name: true, assignedSalesRepId: true, status: true },
  });
  if (!customer) throw new NotFoundError(`Customer ${customerId} does not exist`);
  return customer;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface AccountRow {
  id: string;
  name: string;
  tier: string | null;
  status: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  accountOwnerId: string | null;
  accountOwnerName: string | null;
  /** True when the signed-in user owns this account, for the "Mine" filter. */
  mine: boolean;
  quotationCount: number;
  /** Quotations actually visible in the portal - what a buyer would land on. */
  sharedCount: number;
  portalUsers: { id: string; name: string; email: string; active: boolean }[];
  /** An unexpired, unused link exists, so a new one is not needed yet. */
  hasLiveLink: boolean;
  /** Whether this caller may provision portal access for this account. */
  canGrantAccess: boolean;
}

export async function listAccounts(user: AuthzUser): Promise<AccountRow[]> {
  // Explicitly internal-only rather than relying on the capability check. A
  // portal identity does hold `view quotation`, and Customer scoping would then
  // hand it back its own row - complete with the account owner's name, the
  // other contacts on the account and its deal count. None of that is the
  // customer's to see (D20), and this list is not a customer surface at all.
  if (user.kind !== "INTERNAL") {
    throw new ForbiddenError("Account administration is an internal surface.");
  }
  assertCan(user, "view", "quotation");

  const scope = scopeFor(user, "Customer");
  const now = currentBusinessTime();

  const customers = await prisma.customer.findMany({
    where: scope,
    orderBy: { name: "asc" },
    include: {
      assignedSalesRep: { select: { id: true, name: true } },
      portalUsers: { select: { id: true, name: true, email: true, active: true } },
      portalTokens: {
        where: { consumedAt: null, expiresAt: { gt: now } },
        select: { id: true },
      },
      // Counting in the query rather than loading the quotations, because this
      // list is about accounts and the deals themselves are another screen.
      _count: { select: { quotations: true } },
    },
  });

  const shared = await prisma.quotation.groupBy({
    by: ["customerId"],
    where: { portalStatus: { not: "NOT_SHARED" } },
    _count: { _all: true },
  });
  const sharedByCustomer = new Map(shared.map((row) => [row.customerId, row._count._all]));

  return customers.map((customer) => ({
    id: customer.id,
    name: customer.name,
    tier: customer.tier,
    status: customer.status,
    contactName: customer.contactName,
    email: customer.email,
    phone: customer.phone,
    accountOwnerId: customer.assignedSalesRepId,
    accountOwnerName: customer.assignedSalesRep?.name ?? null,
    mine: customer.assignedSalesRepId === user.id,
    quotationCount: customer._count.quotations,
    sharedCount: sharedByCustomer.get(customer.id) ?? 0,
    portalUsers: customer.portalUsers,
    hasLiveLink: customer.portalTokens.length > 0,
    canGrantAccess: mayGrantPortalAccess(user, customer.assignedSalesRepId),
  }));
}

/** The owner dropdown on the new-account form. Empty for a rep, who owns their own. */
export async function listAssignableOwners(
  user: AuthzUser,
): Promise<{ id: string; name: string; role: string }[]> {
  if (!mayAssignOwner(user)) return [];

  const reps = await prisma.user.findMany({
    where: {
      kind: "INTERNAL",
      active: true,
      role: { in: ["SALES_REP", "SALES_MANAGER"] },
      // A manager staffs their own team; an admin staffs anyone.
      ...(user.role === "SALES_MANAGER" && user.salesTeamId
        ? { salesTeamId: user.salesTeamId }
        : {}),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true },
  });

  return reps.map((rep) => ({ id: rep.id, name: rep.name, role: rep.role ?? "" }));
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface NewAccount {
  name: string;
  tier: CustomerTier;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  accountOwnerId?: string | null;
}

/**
 * Create a customer account.
 *
 * The tier is required here even though the column is nullable. A tier-less
 * customer cannot be quoted at all - `assertCustomerCanBeQuoted` refuses it,
 * because discount ceilings are resolved from the tier and without one every
 * ceiling check passes vacuously - so a form that let you save one would only
 * ever produce an account nobody can sell to.
 */
export async function createCustomerAs(user: AuthzUser, input: NewAccount) {
  assertCan(user, "create");

  const name = input.name.trim();
  if (!name) throw new ValidationError("An account needs a name.", "name");

  const email = input.email?.trim() || null;
  if (email && !email.includes("@")) {
    throw new ValidationError("That does not look like an email address.", "email");
  }

  // A rep owns what they create. A manager or admin may hand it to someone
  // else, and falls back to owning it themselves if they name nobody.
  const owner = mayAssignOwner(user) ? (input.accountOwnerId ?? user.id) : user.id;

  const existing = await prisma.customer.findUnique({ where: { name }, select: { id: true } });
  if (existing) {
    // The unique constraint would catch this, but as an opaque P2002 rather
    // than something the form can point at a field with.
    throw new ConflictError(`An account named "${name}" already exists.`);
  }

  return createCustomer({
    name,
    tier: input.tier,
    contactName: input.contactName?.trim() || null,
    email,
    phone: input.phone?.trim() || null,
    assignedSalesRepId: owner,
    actorId: user.id,
  });
}

/** Add a buyer who may sign in to the portal for this account. */
export async function createPortalUserAs(
  user: AuthzUser,
  input: { customerId: string; email: string; name: string; password?: string },
) {
  const account = await loadAccount(user, input.customerId);
  if (!mayGrantPortalAccess(user, account.assignedSalesRepId)) {
    throw new ForbiddenError("Only the account owner, their manager or an admin may grant portal access.");
  }

  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!email.includes("@")) {
    throw new ValidationError("That does not look like an email address.", "email");
  }
  if (!name) throw new ValidationError("A portal contact needs a name.", "name");

  const clash = await prisma.user.findUnique({
    where: { email },
    select: { id: true, kind: true, customerId: true },
  });
  if (clash) {
    // Naming which case it is matters: the same account is a no-op the user can
    // ignore, a different account is a mistake they need to see.
    throw new ConflictError(
      clash.customerId === input.customerId
        ? `${email} is already a portal contact on this account.`
        : `${email} already belongs to another account.`,
    );
  }

  return createPortalUser({
    email,
    name,
    customerId: input.customerId,
    actorId: user.id,
    password: input.password,
  });
}

export interface IssuedLink {
  /** The full URL to hand over. The raw token is never stored, only its hash. */
  url: string;
  expiresAt: string;
  customerName: string;
}

/**
 * Mint a single-use sign-in link for a customer's buyers.
 *
 * Refused when the account has no portal contact yet, because the link resolves
 * to a customer and then looks for someone to sign in as - handing over a link
 * that cannot possibly work is worse than saying why.
 */
export async function issuePortalLinkAs(
  user: AuthzUser,
  customerId: string,
  portalBaseUrl: string,
): Promise<IssuedLink> {
  const account = await loadAccount(user, customerId);
  if (!mayGrantPortalAccess(user, account.assignedSalesRepId)) {
    throw new ForbiddenError("Only the account owner, their manager or an admin may grant portal access.");
  }

  const contacts = await prisma.user.count({
    where: { customerId, kind: "PORTAL", active: true },
  });
  if (contacts === 0) {
    throw new ValidationError(
      `${account.name} has no portal contact yet. Add one before issuing a link.`,
      "portalUser",
    );
  }

  const link = await issuePortalLink(customerId);

  return {
    url: `${portalBaseUrl.replace(/\/$/, "")}/portal/login?token=${link.rawToken}`,
    expiresAt: link.expiresAt.toISOString(),
    customerName: account.name,
  };
}
