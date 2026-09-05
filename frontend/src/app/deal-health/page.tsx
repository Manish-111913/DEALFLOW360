import { getDealHealthDashboard } from "@dealflow/backend";
import { requireInternalUser } from "@/auth";
import { DealHealthClient } from "./_components/deal-health-client";
import type { HealthRow } from "./_components/deal-rows";

/**
 * Screen 7 - Deal Health & Anomaly Dashboard.
 *
 * This is a Server Component and calls `getDealHealthDashboard` directly rather
 * than fetching its own API route. The route still exists, because the client
 * needs it to refresh after an escalation, but the first paint should not make
 * the browser ask the server for something the server was already rendering -
 * that is a round trip for data we are holding.
 *
 * It also means the capability check happens before any markup is produced: a
 * SALES_REP never receives a table shell that then empties itself.
 */
export default async function DealHealthPage() {
  const user = await requireInternalUser("/deal-health");

  let rows: HealthRow[] = [];
  let denied = false;

  try {
    // The service returns Date objects; they cross into the client component as
    // props, so they are serialised here rather than relying on what survives.
    const dashboard = await getDealHealthDashboard({ user });
    rows = dashboard.map((row) => ({ ...row, computedAt: row.computedAt.toISOString() }));
  } catch (error) {
    // ForbiddenError carries status 403. A SALES_REP has no dealHealth
    // capability at all, which is a legitimate answer rather than a failure.
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      (error as { status: number }).status === 403
    ) {
      denied = true;
    } else {
      throw error;
    }
  }

  return <DealHealthClient denied={denied} initialRows={rows} />;
}
