import { APPROVAL_STATES_VISIBLE_TO_FINANCE } from "../domain/approval";
import type { AuthzUser } from "./roles";

/**
 * D6 — the single data-scoping mechanism.
 *
 * `can()` answers "may this role do this at all". This answers "to which rows".
 * Every query touching a scoped entity composes the fragment returned here. No
 * route, service or component writes its own `where` for a scoped entity —
 * that rule is what replaces the declarative record rules a platform would
 * otherwise have given us, and it is the one place row-level security can be
 * reviewed in full.
 *
 * Almost everything in this system hangs off a Quotation, so scoping is
 * expressed once per role as a Quotation filter and then reached through each
 * entity's relation path. Adding an entity means adding one line to
 * QUOTATION_PATH, not another copy of four role branches.
 */

export type ScopedEntity =
  | "Customer"
  | "User"
  | "AuditLog"
  | "Quotation"
  | "QuotationLine"
  | "QuotationVersion"
  | "RiskFactor"
  | "ApprovalRequest"
  | "UpsellRecommendation"
  | "FulfillmentPlan"
  | "FulfillmentAllocation"
  | "Shipment"
  | "Backorder"
  | "Subscription"
  | "BillingSchedule"
  | "Invoice"
  | "InvoiceLine"
  | "Payment"
  | "CreditNote"
  | "Negotiation"
  | "NegotiationRequest"
  | "NegotiationComment"
  | "DealHealthSnapshot"
  | "DealAlert";

export type WhereFragment = Record<string, unknown>;

/** Matches every row. */
const ALLOW_ALL: WhereFragment = {};

/**
 * Matches no row. Expressed as an unsatisfiable id filter rather than
 * `undefined`, so a caller that forgets to handle "no access" fails closed —
 * spreading `undefined` into a Prisma `where` would silently return everything.
 */
const DENY_ALL: WhereFragment = { id: { in: [] as string[] } };

/**
 * Relation path from each entity to its Quotation.
 *
 * `[]` means the entity *is* the Quotation. `null` means it does not hang off
 * one and is handled separately below. Payment reaches Quotation through
 * Invoice, and BillingSchedule through Subscription — neither carries a direct
 * quotationId, and inventing one to shorten the path would denormalise the
 * schema for the sake of this file.
 */
const QUOTATION_PATH: Record<ScopedEntity, string[] | null> = {
  Quotation: [],
  QuotationLine: ["quotation"],
  QuotationVersion: ["quotation"],
  RiskFactor: ["quotation"],
  ApprovalRequest: ["quotation"],
  UpsellRecommendation: ["quotation"],
  FulfillmentPlan: ["quotation"],
  FulfillmentAllocation: ["quotation"],
  Shipment: ["quotation"],
  Backorder: ["quotation"],
  Subscription: ["quotation"],
  BillingSchedule: ["subscription", "quotation"],
  Invoice: ["quotation"],
  InvoiceLine: ["invoice", "quotation"],
  Payment: ["invoice", "quotation"],
  CreditNote: ["invoice", "quotation"],
  Negotiation: ["quotation"],
  NegotiationRequest: ["negotiation", "quotation"],
  NegotiationComment: ["negotiation", "quotation"],
  DealHealthSnapshot: ["quotation"],
  DealAlert: ["quotation"],
  Customer: null,
  User: null,
  AuditLog: null,
};

/**
 * Entities a portal user may ever reach. Everything absent from this set is
 * denied outright rather than filtered, so a newly added entity is invisible to
 * customers until someone deliberately lists it here.
 */
const PORTAL_VISIBLE: ReadonlySet<ScopedEntity> = new Set<ScopedEntity>([
  "Customer",
  "Quotation",
  "QuotationLine",
  "Invoice",
  "InvoiceLine",
  "Negotiation",
  "NegotiationRequest",
  "NegotiationComment",
]);

/** Wrap a leaf filter in its relation path: ["a","b"], {x} -> {a:{b:{x}}}. */
function nest(path: string[], leaf: WhereFragment): WhereFragment {
  return path.reduceRight<WhereFragment>((acc, key) => ({ [key]: acc }), leaf);
}

/** The Quotation-level filter for an internal role, before nesting. */
function quotationFilterFor(user: AuthzUser): WhereFragment | null {
  switch (user.role) {
    case "ADMIN":
      return ALLOW_ALL;
    case "SALES_REP":
      return { salesRepId: user.id };
    case "SALES_MANAGER":
      // Falls back to their own deals when they hold no team, rather than
      // widening to everything.
      return user.salesTeamId
        ? { salesRep: { salesTeamId: user.salesTeamId } }
        : { salesRepId: user.id };
    case "FINANCE_OPS":
      // Scoped by stage rather than ownership: finance sees deals that have
      // reached them, not every draft in the company.
      return { approvalState: { in: [...APPROVAL_STATES_VISIBLE_TO_FINANCE] } };
    default:
      return null;
  }
}

export function scopeFor(user: AuthzUser, entity: ScopedEntity): WhereFragment {
  if (!user) return DENY_ALL;

  const path = QUOTATION_PATH[entity];

  // --- Portal ------------------------------------------------------------
  if (user.kind === "PORTAL") {
    const customerId = user.customerId;
    if (!customerId) return DENY_ALL;
    if (!PORTAL_VISIBLE.has(entity)) return DENY_ALL;

    if (entity === "Customer") return { id: customerId };
    if (path === null) return DENY_ALL;
    return nest(path, { customerId });
  }

  // --- Internal ----------------------------------------------------------
  const quotationFilter = quotationFilterFor(user);
  if (quotationFilter === null) return DENY_ALL;

  switch (entity) {
    case "Customer":
    case "User":
      return ALLOW_ALL;

    // A partial audit trail is worse than no audit trail: whoever may read it
    // reads all of it. The gate is can(), not a row filter. A rep is denied at
    // model level and sees their own quotation's history through a read-only
    // view action instead.
    case "AuditLog":
      return user.role === "SALES_REP" ? DENY_ALL : ALLOW_ALL;

    default:
      if (path === null) return DENY_ALL;
      // Admin's ALLOW_ALL nested through a path would produce {quotation:{}},
      // which is a needless join; return it unfiltered instead.
      if (user.role === "ADMIN") return ALLOW_ALL;
      return nest(path, quotationFilter);
  }
}

/** True when the fragment denies everything, for tests and guard clauses. */
export function isDenyAll(fragment: WhereFragment): boolean {
  const filter = fragment.id as { in?: unknown[] } | undefined;
  return Array.isArray(filter?.in) && filter.in.length === 0;
}
