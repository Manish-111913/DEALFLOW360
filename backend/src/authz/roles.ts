import type { Role, UserKind } from "../generated/prisma/enums";

/**
 * The role capability matrix.
 *
 * Source: 05_SECURITY.md, as amended by 07_FINAL_IMPLEMENTATION_DECISIONS.md:
 *
 *   D16 — the Sales Manager configures discount tiers and approval chains.
 *         05_SECURITY.md says view-only/Admin-only and is wrong; §3 of the
 *         official problem statement assigns this to the Sales Manager.
 *
 *   D17 — Finance/Operations owns fulfilment allocation and backorder
 *         decisions. The Sales Rep keeps read-only visibility of fulfilment
 *         progress, so a rep can answer "where is my order" without being able
 *         to change it.
 *
 * This answers "is this role allowed to do this at all". It is not row
 * scoping — "which records" is `scopeFor` in ./scope.ts. Both are required:
 * a Sales Rep may update quotations (here) but only their own (there).
 */

export interface AuthzUser {
  id: string;
  kind: UserKind;
  role: Role | null;
  customerId: string | null;
  salesTeamId?: string | null;
}

export type Action =
  | "view"
  | "create"
  | "update"
  | "delete"
  | "decide"
  | "configure"
  | "allocate"
  | "escalate"
  | "recordPayment"
  | "issueCredit"
  | "negotiate"
  | "confirm";

export type ConfigSubject =
  | "discountTier"
  | "approvalChain"
  | "product"
  | "priceList"
  | "warehouse"
  | "subscriptionPlan"
  | "upsellRule";

export type ViewSubject =
  | "quotation"
  | "margin"
  | "riskDetail"
  | "fulfilmentProgress"
  | "auditLog"
  | "dealHealth"
  | "report"
  | "billingSchedule";

/** An approval step, for the step-type guard. */
export interface StepResource {
  stepType: "manager" | "finance";
}

export type Resource = ConfigSubject | ViewSubject | StepResource | undefined;

function isStep(resource: Resource): resource is StepResource {
  return typeof resource === "object" && resource !== null && "stepType" in resource;
}

const ADMIN_CONFIG: ConfigSubject[] = [
  "product",
  "priceList",
  "warehouse",
  "subscriptionPlan",
  "upsellRule",
  "discountTier",
  "approvalChain",
];

/** D16: the two policy surfaces a Sales Manager owns. */
const MANAGER_CONFIG: ConfigSubject[] = ["discountTier", "approvalChain"];

const REP_VIEW: ViewSubject[] = [
  "quotation",
  "margin",
  "riskDetail",
  "fulfilmentProgress", // D17 — visibility without control
  "billingSchedule",
];

const MANAGER_VIEW: ViewSubject[] = [...REP_VIEW, "auditLog", "dealHealth", "report"];

const FINANCE_VIEW: ViewSubject[] = [...REP_VIEW, "auditLog", "dealHealth", "report"];

const ADMIN_VIEW: ViewSubject[] = [
  "quotation",
  "margin",
  "riskDetail",
  "fulfilmentProgress",
  "auditLog",
  "dealHealth",
  "report",
  "billingSchedule",
];

/** Subjects a portal user may ever see. Never margin, risk or audit. */
const PORTAL_VIEW: ViewSubject[] = ["quotation"];

export function can(user: AuthzUser, action: Action, resource?: Resource): boolean {
  if (!user) return false;

  // --- Portal users -------------------------------------------------------
  // A portal identity is not a weaker internal role; it is a different surface.
  // Everything not listed here is denied, including margin and risk (D20).
  if (user.kind === "PORTAL") {
    switch (action) {
      case "view":
        return typeof resource === "string" && (PORTAL_VIEW as string[]).includes(resource);
      case "negotiate":
      case "confirm":
        return true;
      default:
        return false;
    }
  }

  switch (user.role) {
    // --- Sales Rep --------------------------------------------------------
    case "SALES_REP":
      switch (action) {
        case "view":
          return typeof resource === "string" && (REP_VIEW as string[]).includes(resource);
        case "create":
        case "update":
          return true; // scoped to their own quotations by scopeFor
        case "delete":
          // Nothing disappears mid-approval; drafts are handled by state, not deletion.
          return false;
        // D17: a rep sees fulfilment but never decides it.
        case "allocate":
        case "decide":
        case "configure":
        case "escalate":
        case "recordPayment":
        case "issueCredit":
        case "negotiate":
        case "confirm":
          return false;
        default:
          return false;
      }

    // --- Sales Manager ----------------------------------------------------
    case "SALES_MANAGER":
      switch (action) {
        case "view":
          return typeof resource === "string" && (MANAGER_VIEW as string[]).includes(resource);
        case "create":
        case "update":
          return true;
        // The step-type check is the point: being senior does not make a
        // manager a finance approver. Enforced here, not by hiding a button.
        case "decide":
          return isStep(resource) && resource.stepType === "manager";
        case "configure":
          return typeof resource === "string" && (MANAGER_CONFIG as string[]).includes(resource);
        case "escalate":
          return true;
        case "allocate":
        case "recordPayment":
        case "issueCredit":
        case "delete":
        case "negotiate":
        case "confirm":
          return false;
        default:
          return false;
      }

    // --- Finance / Operations --------------------------------------------
    case "FINANCE_OPS":
      switch (action) {
        case "view":
          return typeof resource === "string" && (FINANCE_VIEW as string[]).includes(resource);
        case "decide":
          return isStep(resource) && resource.stepType === "finance";
        case "allocate": // D17
          return true;
        case "recordPayment":
        case "issueCredit":
          return true;
        case "update":
          return true;
        case "create":
        case "delete":
        case "configure":
        case "escalate":
        case "negotiate":
        case "confirm":
          return false;
        default:
          return false;
      }

    // --- Admin ------------------------------------------------------------
    // Admin configures the system; it does not play every role in it. No
    // approve/reject shortcut, and no allocation decision — both are
    // operational acts belonging to a named human role.
    case "ADMIN":
      switch (action) {
        case "view":
          return typeof resource === "string" && (ADMIN_VIEW as string[]).includes(resource);
        case "configure":
          return typeof resource === "string" && (ADMIN_CONFIG as string[]).includes(resource);
        case "create":
        case "update":
        case "delete":
          return true;
        case "decide":
        case "allocate":
        case "recordPayment":
        case "issueCredit":
        case "escalate":
        case "negotiate":
        case "confirm":
          return false;
        default:
          return false;
      }

    default:
      return false;
  }
}

/** Throwing variant, for route handlers and services. */
export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function assertCan(user: AuthzUser, action: Action, resource?: Resource): void {
  if (!can(user, action, resource)) {
    const subject = isStep(resource) ? `${resource.stepType} step` : (resource ?? "resource");
    throw new ForbiddenError(
      `${user.role ?? user.kind} may not ${action} ${String(subject)}`,
    );
  }
}
