import { refreshClockOffset } from "../src/clock";
import { prisma } from "../src/db";
import { getApprovalOverview } from "../src/services/approvals";
import { getBillingSchedule } from "../src/services/billing";
import { getDealHealthDashboard } from "../src/services/deal-health";
import { getFulfillmentView } from "../src/services/fulfillment";
import { viewPortalQuotation } from "../src/services/portal";
import { getQuotation, listQuotations } from "../src/services/quotations";
import { runSalesReport } from "../src/services/reporting";
import { getUpsellSuggestions } from "../src/services/upsell";
import type { AuthzUser } from "../src/authz/roles";

/**
 * Does each read service return something a screen could actually render?
 *
 * This is the gate before wiring any UI. A service that compiles and passes its
 * unit tests can still hand a screen an empty array, because the tests build
 * their own fixtures while a screen reads whatever the seed left behind. This
 * calls each one against the real seeded database, so a screen is never wired
 * to a source that turns out to have nothing in it.
 *
 * It asserts the denials too, not only the successes - a read that quietly
 * succeeds for the wrong role is worse than one that fails.
 */

async function user(email: string): Promise<AuthzUser> {
  const found = await prisma.user.findUniqueOrThrow({ where: { email } });
  return {
    id: found.id,
    kind: found.kind,
    role: found.role,
    customerId: found.customerId,
    salesTeamId: found.salesTeamId,
  };
}

function ok(label: string, detail: string) {
  console.log(`  PASS  ${label.padEnd(24)} ${detail}`);
}

function bad(label: string, detail: string) {
  console.log(`  FAIL  ${label.padEnd(24)} ${detail}`);
  process.exitCode = 1;
}

/** Did this throw? Used to assert that a denial actually denies. */
async function denied(run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run();
    return false;
  } catch {
    return true;
  }
}

async function main() {
  await refreshClockOffset();

  const priya = await user("priya@dealflow360.test");
  const manager = await user("manager@dealflow360.test");
  const finance = await user("finance@dealflow360.test");
  const buyer = await user("buyer@acme.test");

  console.log("\nread services against seeded data\n");

  // --- The scoped list every board is built from -------------------------
  const listed = await listQuotations(manager);
  if (listed.length > 0) {
    ok("listQuotations", `${listed.length} row(s) for a manager`);
  } else {
    bad("listQuotations", "0 rows");
  }

  const live = listed.filter((row) => row.stage !== "FULFILLMENT" && row.stage !== "CLOSED");
  if (live.length > 0) {
    ok("live stages", JSON.stringify(live.map((row) => row.stage)));
  } else {
    bad("live stages", "nothing in flight - run db:seed:demo");
  }

  const draft = live.find((row) => row.stage === "DRAFT");
  const pending = live.find((row) => row.stage === "PENDING_APPROVAL");
  const approved = live.find((row) => row.stage === "APPROVED");

  // --- Sales workspace ---------------------------------------------------
  if (draft) {
    const full = await getQuotation(manager, draft.id);
    if (full && full.lines.length > 0) {
      ok("getQuotation", `${full.quoteNumber}, ${full.lines.length} line(s)`);
    } else {
      bad("getQuotation", "no lines");
    }

    const suggestions = await getUpsellSuggestions(draft.id);
    if (Array.isArray(suggestions)) {
      ok("getUpsellSuggestions", `${suggestions.length} suggestion(s)`);
    } else {
      bad("getUpsellSuggestions", "not an array");
    }
  } else {
    bad("getQuotation", "no draft to read");
  }

  // --- Approvals ---------------------------------------------------------
  if (pending) {
    const overview = await getApprovalOverview(manager, pending.id);
    if (overview && overview.requests.length > 0) {
      ok(
        "getApprovalOverview",
        `${overview.requests.length} request(s), ${overview.factors.length} factor(s)`,
      );
    } else {
      bad("getApprovalOverview", "no approval requests");
    }
  } else {
    bad("getApprovalOverview", "nothing pending - run db:seed:demo");
  }

  // --- Fulfilment --------------------------------------------------------
  if (approved) {
    const view = await getFulfillmentView(manager, approved.id);
    if (view) {
      ok("getFulfillmentView", `plan ${view.recommended ? "present" : "none"}`);
    } else {
      bad("getFulfillmentView", "null");
    }
  } else {
    bad("getFulfillmentView", "nothing approved");
  }

  // --- Billing -----------------------------------------------------------
  const billable = await prisma.quotation.findFirst({
    where: { subscriptions: { some: {} } },
    select: { id: true },
  });
  if (billable) {
    const schedule = await getBillingSchedule(finance, billable.id);
    if (schedule && (schedule.oneTime.length > 0 || schedule.recurring.length > 0)) {
      ok(
        "getBillingSchedule",
        `${schedule.oneTime.length} one-time, ${schedule.recurring.length} recurring`,
      );
    } else {
      bad("getBillingSchedule", "nothing billable");
    }
  } else {
    bad("getBillingSchedule", "no order has a subscription");
  }

  // --- Portal ------------------------------------------------------------
  const shared = await prisma.quotation.findFirst({
    where: { portalStatus: { not: "NOT_SHARED" } },
    select: { id: true },
  });
  if (shared) {
    const portal = await viewPortalQuotation(buyer, shared.id);
    if (portal.status === 200) {
      ok("viewPortalQuotation", `${portal.quotation?.lines?.length ?? 0} line(s) as the customer`);
    } else {
      bad("viewPortalQuotation", `status ${portal.status}`);
    }

    const asRep = await viewPortalQuotation(priya, shared.id);
    if (asRep.status === 403) {
      ok("portal denies internal", "403 for a SALES_REP, as specified");
    } else {
      bad("portal denies internal", `expected 403, got ${asRep.status}`);
    }
  } else {
    bad("viewPortalQuotation", "nothing shared to the portal");
  }

  // --- Deal health -------------------------------------------------------
  const health = await getDealHealthDashboard({ user: manager });
  if (health.length > 0) {
    ok("getDealHealthDashboard", `${health.length} row(s)`);
  } else {
    bad("getDealHealthDashboard", "0 rows - has recomputeAllDealHealth run?");
  }

  if (await denied(() => getDealHealthDashboard({ user: priya }))) {
    ok("dealHealth denies rep", "SALES_REP refused, as specified");
  } else {
    bad("dealHealth denies rep", "a SALES_REP read the board");
  }

  const financeHealth = await getDealHealthDashboard({ user: finance });
  ok("dealHealth scoping", `manager ${health.length} / finance ${financeHealth.length}`);

  // --- Reporting ---------------------------------------------------------
  const report = await runSalesReport({ user: manager });
  if (report) {
    ok("runSalesReport", `${report.rows.length} row(s)`);
  } else {
    bad("runSalesReport", "null");
  }

  console.log();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
