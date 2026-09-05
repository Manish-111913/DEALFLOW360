import { describe, expect, it } from "vitest";
import type { AuthzUser } from "./roles";
import { isDenyAll, type ScopedEntity, scopeFor } from "./scope";

const rep: AuthzUser = { id: "u-rep", kind: "INTERNAL", role: "SALES_REP", customerId: null, salesTeamId: "t1" };
const manager: AuthzUser = { id: "u-mgr", kind: "INTERNAL", role: "SALES_MANAGER", customerId: null, salesTeamId: "t1" };
const finance: AuthzUser = { id: "u-fin", kind: "INTERNAL", role: "FINANCE_OPS", customerId: null, salesTeamId: null };
const admin: AuthzUser = { id: "u-adm", kind: "INTERNAL", role: "ADMIN", customerId: null, salesTeamId: null };
const portal: AuthzUser = { id: "u-por", kind: "PORTAL", role: null, customerId: "c-acme", salesTeamId: null };

describe("quotation scoping by role", () => {
  it("limits a rep to their own quotations", () => {
    expect(scopeFor(rep, "Quotation")).toEqual({ salesRepId: "u-rep" });
  });

  it("limits a manager to their team", () => {
    expect(scopeFor(manager, "Quotation")).toEqual({ salesRep: { salesTeamId: "t1" } });
  });

  it("falls back to a manager's own deals when they have no team", () => {
    const teamless: AuthzUser = { ...manager, salesTeamId: null };
    expect(scopeFor(teamless, "Quotation")).toEqual({ salesRepId: "u-mgr" });
  });

  it("limits Finance to deals that have reached them", () => {
    expect(scopeFor(finance, "Quotation")).toEqual({
      approvalState: { in: ["PENDING_FINANCE", "APPROVED"] },
    });
  });

  it("gives Admin everything", () => {
    expect(scopeFor(admin, "Quotation")).toEqual({});
  });

  it("limits a portal user to their own customer", () => {
    expect(scopeFor(portal, "Quotation")).toEqual({ customerId: "c-acme" });
    expect(scopeFor(portal, "Customer")).toEqual({ id: "c-acme" });
  });
});

describe("relation paths reach Quotation correctly", () => {
  it("nests one level for a direct child", () => {
    expect(scopeFor(rep, "QuotationLine")).toEqual({
      quotation: { salesRepId: "u-rep" },
    });
  });

  // Payment carries no quotationId — it hangs off Invoice. Inventing a direct
  // FK to shorten this path would denormalise the schema.
  it("nests two levels for Payment, through Invoice", () => {
    expect(scopeFor(rep, "Payment")).toEqual({
      invoice: { quotation: { salesRepId: "u-rep" } },
    });
  });

  it("nests two levels for BillingSchedule, through Subscription", () => {
    expect(scopeFor(finance, "BillingSchedule")).toEqual({
      subscription: {
        quotation: { approvalState: { in: ["PENDING_FINANCE", "APPROVED"] } },
      },
    });
  });

  it("nests two levels for NegotiationRequest, through Negotiation", () => {
    expect(scopeFor(manager, "NegotiationRequest")).toEqual({
      negotiation: { quotation: { salesRep: { salesTeamId: "t1" } } },
    });
  });

  it("reaches a portal user's own lines through the quotation", () => {
    expect(scopeFor(portal, "QuotationLine")).toEqual({
      quotation: { customerId: "c-acme" },
    });
  });

  // Admin's filter is empty, so nesting it would emit {quotation:{}} — a join
  // that filters nothing.
  it("does not emit a pointless join for Admin", () => {
    expect(scopeFor(admin, "Payment")).toEqual({});
    expect(scopeFor(admin, "QuotationLine")).toEqual({});
  });
});

describe("fail-closed behaviour", () => {
  it("denies rather than allows when a portal user has no customer", () => {
    const orphan: AuthzUser = { ...portal, customerId: null };
    expect(isDenyAll(scopeFor(orphan, "Quotation"))).toBe(true);
  });

  it("denies an internal user with no role", () => {
    const roleless: AuthzUser = { id: "x", kind: "INTERNAL", role: null, customerId: null };
    expect(isDenyAll(scopeFor(roleless, "Quotation"))).toBe(true);
  });

  // The deny fragment must be unsatisfiable rather than empty: spreading `{}`
  // into a Prisma `where` would return every row, so "no access" has to be
  // expressed as a filter that matches nothing.
  it("expresses denial as an unsatisfiable filter, never as {}", () => {
    const denied = scopeFor(portal, "AuditLog");
    expect(denied).not.toEqual({});
    expect(isDenyAll(denied)).toBe(true);
  });
});

describe("internal-only entities are invisible to the portal", () => {
  const internalOnly: ScopedEntity[] = [
    "AuditLog",
    "User",
    "QuotationVersion",
    "RiskFactor",
    "ApprovalRequest",
    "UpsellRecommendation",
    "FulfillmentPlan",
    "FulfillmentAllocation",
    "Shipment",
    "Backorder",
    "Subscription",
    "BillingSchedule",
    "Payment",
    "CreditNote",
    "DealHealthSnapshot",
    "DealAlert",
  ];

  it.each(internalOnly)("denies portal access to %s", (entity) => {
    expect(isDenyAll(scopeFor(portal, entity))).toBe(true);
  });

  // RiskFactor is the risk-score breakdown and DealHealthSnapshot the internal
  // scoring — both would leak exactly what D20 says a customer must never see.
  it("never exposes the risk breakdown to a customer", () => {
    expect(isDenyAll(scopeFor(portal, "RiskFactor"))).toBe(true);
    expect(isDenyAll(scopeFor(portal, "DealHealthSnapshot"))).toBe(true);
  });
});

describe("portal-visible entities", () => {
  const portalVisible: ScopedEntity[] = [
    "Customer",
    "Quotation",
    "QuotationLine",
    "Invoice",
    "InvoiceLine",
    "Negotiation",
    "NegotiationRequest",
    "NegotiationComment",
  ];

  it.each(portalVisible)("allows scoped portal access to %s", (entity) => {
    expect(isDenyAll(scopeFor(portal, entity))).toBe(false);
  });
});

describe("audit log scoping", () => {
  it("is withheld from a rep", () => {
    expect(isDenyAll(scopeFor(rep, "AuditLog"))).toBe(true);
  });

  it("is unnarrowed for manager, finance and admin", () => {
    expect(scopeFor(manager, "AuditLog")).toEqual({});
    expect(scopeFor(finance, "AuditLog")).toEqual({});
    expect(scopeFor(admin, "AuditLog")).toEqual({});
  });
});
