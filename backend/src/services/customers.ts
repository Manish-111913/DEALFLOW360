import type { CustomerTier } from "../generated/prisma/enums";
import type { AuthzUser } from "../authz/roles";
import { assertCan, can } from "../authz/roles";
import { scopeFor } from "../authz/scope";
import { appendAudit } from "../audit";
import { currentBusinessTime } from "../clock";
import { prisma } from "../db";
import { NotFoundError, ValidationError } from "../errors";

export type CustomerAccess =
  | { status: 200; customer: { id: string; name: string; tier: string | null } }
  | { status: 401 | 403 | 404 };

/**
 * Read one customer, subject to both gates: `can()` for "may this role at all",
 * `scopeFor()` for "which rows". The scope fragment is composed into the query
 * rather than checked after the fact, so an out-of-scope record is never loaded
 * into memory in the first place.
 *
 * A record that exists but sits outside the caller's scope returns 403, not
 * 404 — see frontend/src/lib/http.ts for why.
 */
export async function readCustomer(
  user: AuthzUser | null,
  customerId: string,
): Promise<CustomerAccess> {
  if (!user) return { status: 401 };
  if (!can(user, "view", "quotation")) return { status: 403 };

  const scope = scopeFor(user, "Customer");
  const inScope = await prisma.customer.findFirst({
    where: { AND: [{ id: customerId }, scope] },
    select: { id: true, name: true, tier: true },
  });

  if (inScope) return { status: 200, customer: inScope };

  // Distinguish "does not exist" from "not yours" so the caller returns the
  // response the spec asks for in each case.
  const exists = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true },
  });
  return { status: exists ? 403 : 404 };
}

/**
 * A quotation cannot exist for a customer with no tier.
 *
 * Without a tier there is no discount ceiling to check a line against, so every
 * governance rule downstream would pass vacuously — the quote would look
 * compliant precisely because nothing was checked. Failing loudly at creation
 * is the only honest option.
 *
 * Enforced twice on purpose: here, with a message naming the field, and again
 * by a database trigger on Quotation insert, so no code path can route around
 * it. See the b2 migration.
 */
export async function assertCustomerCanBeQuoted(customerId: string): Promise<void> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, name: true, tier: true, status: true },
  });

  if (!customer) throw new NotFoundError(`Customer ${customerId} does not exist`);

  if (customer.tier === null) {
    throw new ValidationError(
      `Customer "${customer.name}" has no tier set. A quotation cannot be created ` +
        `without one, because discount ceilings are resolved from the customer tier.`,
      "tier",
    );
  }

  if (customer.status !== "ACTIVE") {
    throw new ValidationError(
      `Customer "${customer.name}" is not active.`,
      "status",
    );
  }
}

/**
 * Change a customer's tier.
 *
 * Audited because a tier change silently alters which ceiling every open
 * quotation for that customer is checked against from this point on — a
 * governance change disguised as a contact-record edit.
 */
export async function setCustomerTier(params: {
  customerId: string;
  tier: CustomerTier;
  actorId?: string | null;
  reason?: string;
}) {
  const existing = await prisma.customer.findUnique({
    where: { id: params.customerId },
    select: { id: true, name: true, tier: true },
  });
  if (!existing) throw new NotFoundError(`Customer ${params.customerId} does not exist`);

  const updated = await prisma.customer.update({
    where: { id: params.customerId },
    data: { tier: params.tier, updatedAt: currentBusinessTime() },
  });

  await appendAudit({
    entityName: "Customer",
    entityId: updated.id,
    action: "UPDATE",
    actorId: params.actorId ?? null,
    reason: params.reason ?? "Customer tier changed",
    fieldChanges: { tier: { before: existing.tier, after: updated.tier } },
  });

  return updated;
}

export interface CreateCustomerInput {
  name: string;
  tier?: CustomerTier | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  assignedSalesRepId?: string | null;
  actorId?: string | null;
}

export async function createCustomer(input: CreateCustomerInput) {
  const now = currentBusinessTime();
  const customer = await prisma.customer.create({
    data: {
      name: input.name,
      tier: input.tier ?? null,
      contactName: input.contactName ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      assignedSalesRepId: input.assignedSalesRepId ?? null,
      createdAt: now,
      updatedAt: now,
    },
  });

  await appendAudit({
    entityName: "Customer",
    entityId: customer.id,
    action: "CREATE",
    actorId: input.actorId ?? null,
    reason: "Customer created",
    fieldChanges: { name: customer.name, tier: customer.tier },
  });

  return customer;
}

/** One row in the customer picker on the New Quotation dialog. */
export interface QuotableCustomer {
  id: string;
  name: string;
  tier: string | null;
  status: string;
  /** The rep this account belongs to, when one is assigned. */
  accountOwnerId: string | null;
}

/**
 * Customers this user may raise a quotation for.
 *
 * Deliberately not every customer in the database. A rep sees the accounts
 * assigned to them plus unassigned ones they could pick up; managers, finance
 * and admins see all of them. That mirrors the row scope the rest of the
 * application applies to quotations, so the picker cannot offer an account the
 * resulting quote would then be invisible on.
 *
 * The same two conditions `assertCustomerCanBeQuoted` enforces are applied
 * here - active, and with a tier set - so the picker cannot offer an account
 * that the create call would then refuse. A tier-less customer is genuinely
 * unquotable: discount ceilings are resolved from the tier, and without one
 * every ceiling check would silently pass.
 */
export async function listQuotableCustomers(user: AuthzUser): Promise<QuotableCustomer[]> {
  assertCan(user, "create", "quotation");

  const seesEveryAccount =
    user.role === "SALES_MANAGER" || user.role === "FINANCE_OPS" || user.role === "ADMIN";

  const rows = await prisma.customer.findMany({
    where: {
      status: "ACTIVE",
      tier: { not: null },
      ...(seesEveryAccount
        ? {}
        : { OR: [{ assignedSalesRepId: user.id }, { assignedSalesRepId: null }] }),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, tier: true, status: true, assignedSalesRepId: true },
  });

  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    tier: c.tier,
    status: c.status,
    accountOwnerId: c.assignedSalesRepId,
  }));
}
