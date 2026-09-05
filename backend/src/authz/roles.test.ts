import { describe, expect, it } from "vitest";
import { type AuthzUser, can } from "./roles";

const rep: AuthzUser = { id: "u-rep", kind: "INTERNAL", role: "SALES_REP", customerId: null, salesTeamId: "t1" };
const manager: AuthzUser = { id: "u-mgr", kind: "INTERNAL", role: "SALES_MANAGER", customerId: null, salesTeamId: "t1" };
const finance: AuthzUser = { id: "u-fin", kind: "INTERNAL", role: "FINANCE_OPS", customerId: null, salesTeamId: null };
const admin: AuthzUser = { id: "u-adm", kind: "INTERNAL", role: "ADMIN", customerId: null, salesTeamId: null };
const portal: AuthzUser = { id: "u-por", kind: "PORTAL", role: null, customerId: "c-acme", salesTeamId: null };

describe("approval step type is checked, not seniority", () => {
  // PL-B1's named scenario. A Finance user calling the API directly must be
  // refused a manager-type step; being an approver of one kind is not being an
  // approver of every kind.
  it("refuses Finance on a manager step", () => {
    expect(can(finance, "decide", { stepType: "manager" })).toBe(false);
  });

  it("allows Finance on a finance step", () => {
    expect(can(finance, "decide", { stepType: "finance" })).toBe(true);
  });

  it("refuses a manager on a finance step", () => {
    expect(can(manager, "decide", { stepType: "finance" })).toBe(false);
  });

  it("allows a manager on a manager step", () => {
    expect(can(manager, "decide", { stepType: "manager" })).toBe(true);
  });

  it("gives Admin no approval shortcut", () => {
    expect(can(admin, "decide", { stepType: "manager" })).toBe(false);
    expect(can(admin, "decide", { stepType: "finance" })).toBe(false);
  });

  it("refuses a rep entirely", () => {
    expect(can(rep, "decide", { stepType: "manager" })).toBe(false);
  });
});

describe("D16 — Sales Manager configures discount policy", () => {
  it("allows discount tiers and approval chains", () => {
    expect(can(manager, "configure", "discountTier")).toBe(true);
    expect(can(manager, "configure", "approvalChain")).toBe(true);
  });

  it("stops short of catalogue and warehouse configuration", () => {
    expect(can(manager, "configure", "product")).toBe(false);
    expect(can(manager, "configure", "warehouse")).toBe(false);
    expect(can(manager, "configure", "subscriptionPlan")).toBe(false);
  });

  it("still allows Admin everything configurable", () => {
    for (const subject of ["discountTier", "approvalChain", "product", "priceList", "warehouse", "subscriptionPlan", "upsellRule"] as const) {
      expect(can(admin, "configure", subject)).toBe(true);
    }
  });

  it("refuses a rep any configuration", () => {
    expect(can(rep, "configure", "discountTier")).toBe(false);
  });
});

describe("D17 — Finance owns fulfilment, the rep only watches it", () => {
  it("lets the rep see fulfilment progress", () => {
    expect(can(rep, "view", "fulfilmentProgress")).toBe(true);
  });

  it("does not let the rep allocate", () => {
    expect(can(rep, "allocate")).toBe(false);
  });

  it("lets Finance allocate", () => {
    expect(can(finance, "allocate")).toBe(true);
  });

  it("does not let a manager or admin allocate", () => {
    expect(can(manager, "allocate")).toBe(false);
    expect(can(admin, "allocate")).toBe(false);
  });

  it("keeps payment and credit notes with Finance", () => {
    expect(can(finance, "recordPayment")).toBe(true);
    expect(can(finance, "issueCredit")).toBe(true);
    expect(can(rep, "recordPayment")).toBe(false);
    expect(can(manager, "recordPayment")).toBe(false);
  });
});

describe("portal identity is a different surface, not a weaker role", () => {
  it("may negotiate and confirm", () => {
    expect(can(portal, "negotiate")).toBe(true);
    expect(can(portal, "confirm")).toBe(true);
  });

  it("never sees margin, risk detail or the audit log", () => {
    expect(can(portal, "view", "margin")).toBe(false);
    expect(can(portal, "view", "riskDetail")).toBe(false);
    expect(can(portal, "view", "auditLog")).toBe(false);
    expect(can(portal, "view", "dealHealth")).toBe(false);
  });

  it("cannot decide, allocate or configure anything", () => {
    expect(can(portal, "decide", { stepType: "manager" })).toBe(false);
    expect(can(portal, "allocate")).toBe(false);
    expect(can(portal, "configure", "discountTier")).toBe(false);
  });
});

describe("audit log visibility", () => {
  it("is withheld from a rep at model level", () => {
    expect(can(rep, "view", "auditLog")).toBe(false);
  });

  it("is available to manager, finance and admin", () => {
    expect(can(manager, "view", "auditLog")).toBe(true);
    expect(can(finance, "view", "auditLog")).toBe(true);
    expect(can(admin, "view", "auditLog")).toBe(true);
  });
});
