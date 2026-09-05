import {
  currentBusinessTime,
  getDealHealthDashboard,
  getPipelineSummary,
  listQuotations,
} from "@dealflow/backend";
import { requireInternalUser } from "@/auth";
import { CommandCentreClient } from "./_components/command-centre-client";

/**
 * Screen 1 - the command centre.
 *
 * There is no single "dashboard" service, and there should not be: this screen
 * is a composition of things that already exist, each of which is scoped and
 * capability-checked in its own right. So the page assembles the scoped
 * quotation list, the pipeline summary and - only if the caller may see it -
 * the deal-health board.
 *
 * That last one is the reason for the try/catch. A SALES_REP has no dealHealth
 * capability at all, and their home page should still work; it simply has no
 * at-risk figure on it. Letting the ForbiddenError escape would 500 the home
 * page for the role that uses it most.
 */
export default async function CommandCentrePage() {
  const user = await requireInternalUser("/dashboard");

  const now = currentBusinessTime();

  const [rows, pipeline] = await Promise.all([
    listQuotations(user),
    getPipelineSummary(user),
  ]);

  let atRisk: number | null = null;
  let alerts: { quotationId: string; quoteNumber: string; customerName: string; message: string }[] =
    [];

  try {
    const health = await getDealHealthDashboard({ user });
    atRisk = health.filter(
      (row) => row.severity === "CRITICAL" || row.severity === "AT_RISK",
    ).length;
    alerts = health
      .flatMap((row) =>
        row.openAlerts.map((alert) => ({
          quotationId: row.quotationId,
          quoteNumber: row.quoteNumber,
          customerName: row.customerName,
          message: alert.message,
        })),
      )
      .slice(0, 4);
  } catch {
    // No dealHealth capability. The board is simply absent, not broken.
    atRisk = null;
  }

  const pendingApproval = rows.filter((row) => row.stage === "PENDING_APPROVAL");
  const inFulfilment = rows.filter((row) => row.stage === "FULFILLMENT");
  const live = rows.filter((row) => row.stage !== "FULFILLMENT" && row.stage !== "CLOSED");

  // "Expiring" is measured against business time, not the browser's clock.
  const expiringSoon = live
    .filter((row) => row.validUntil !== null)
    .map((row) => ({
      id: row.id,
      quoteNumber: row.quoteNumber,
      customerName: row.customerName,
      validUntil: row.validUntil as Date,
      daysLeft: Math.ceil(
        ((row.validUntil as Date).getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
      ),
    }))
    .filter((row) => row.daysLeft <= 30)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 5);

  return (
    <CommandCentreClient
      data={{
        role: user.role ?? "",
        kpis: {
          activeDeals: live.length,
          pendingApprovals: pendingApproval.length,
          atRisk,
          inFulfilment: inFulfilment.length,
          totalPipeline: pipeline.totalValue,
        },
        pipeline: pipeline.stages.map((stage) => ({
          stage: stage.stage,
          count: stage.count,
          value: stage.value,
        })),
        recent: rows.slice(0, 6).map((row) => ({
          id: row.id,
          quoteNumber: row.quoteNumber,
          customerName: row.customerName,
          salesRepName: row.salesRepName,
          stage: row.stage,
          totalAmount: row.totalAmount,
          marginPercentage: row.marginPercentage,
        })),
        alerts,
        expiring: expiringSoon.map((row) => ({
          id: row.id,
          quoteNumber: row.quoteNumber,
          customerName: row.customerName,
          daysLeft: row.daysLeft,
        })),
      }}
    />
  );
}
