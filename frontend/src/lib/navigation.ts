/**
 * The seven screens and where they live.
 *
 * Every screen carries its own floating dock, drawn differently on each - the
 * command centre labels it "Deal Health", the approvals screen shortens it to
 * "Health", billing uses smaller icons. We keep each dock's own markup, because
 * reproducing the screens exactly is the point; what they share is this list of
 * destinations, so a renamed route changes one line rather than seven docks.
 */

export const ROUTES = {
  /** The public marketing page. The only route a signed-out visitor lands on. */
  landing: "/",
  /** Where signing in takes you. `landing` owns "/" now, so this is explicit. */
  home: "/dashboard",
  sales: "/sales",
  approvals: "/approvals",
  fulfillment: "/fulfillment",
  billing: "/billing",
  negotiation: "/negotiation",
  dealHealth: "/deal-health",
} as const;

export type RouteKey = keyof typeof ROUTES;
export type Route = (typeof ROUTES)[RouteKey];

/** Which dock item is highlighted, keyed the same way as ROUTES. */
export const SCREEN_TITLES: Record<RouteKey, string> = {
  landing: "DealFlow360",
  home: "Command Center",
  sales: "Sales Workspace",
  approvals: "Discount Approval",
  fulfillment: "Fulfillment & Warehouse Allocation",
  billing: "Subscription & Billing",
  negotiation: "Customer Negotiation Portal",
  dealHealth: "Deal Health & Anomaly Dashboard",
};
