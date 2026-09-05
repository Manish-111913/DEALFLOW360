"use client";

import Link from "next/link";
import {
  AgentButton,
  AppShell,
  AppWindow,
  StatusBar,
  WindowScroll,
} from "@/components/app-shell";
import { AppDock } from "@/components/app-dock";
import { PAGE_SUBTITLE, PAGE_TITLE, SCROLL_PADDING } from "@/components/design-tokens";
import { ROUTES } from "@/lib/navigation";
import { formatCompact, formatRupees } from "@/lib/money";

/**
 * Screen 1 - the command centre, on live data.
 *
 * Every figure here is counted from the caller's own scoped rows, so a rep and
 * a manager see genuinely different dashboards from the same component.
 *
 * Three panels from the original design are gone rather than faked. The weekly
 * velocity chart, the calendar of meetings and the team activity feed had no
 * source behind them - there is no meeting model, and the audit log is only
 * readable per entity, not as a firehose. Inventing numbers for them would make
 * the one screen a user checks first the least trustworthy in the product. What
 * replaced them is real: quotations actually approaching expiry, and the open
 * alerts the health scorer raised.
 */

interface Kpis {
  activeDeals: number;
  pendingApprovals: number;
  /** null when the caller has no dealHealth capability. */
  atRisk: number | null;
  inFulfilment: number;
  totalPipeline: string;
}

export interface CommandCentreData {
  role: string;
  kpis: Kpis;
  pipeline: { stage: string; count: number; value: string }[];
  recent: {
    id: string;
    quoteNumber: string;
    customerName: string;
    salesRepName: string;
    stage: string;
    totalAmount: string;
    marginPercentage: string;
  }[];
  alerts: { quotationId: string; quoteNumber: string; customerName: string; message: string }[];
  expiring: { id: string; quoteNumber: string; customerName: string; daysLeft: number }[];
}

const STAGE_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending Approval",
  NEGOTIATION: "Negotiation",
  APPROVED: "Approved",
  FULFILLMENT: "Fulfillment",
  CLOSED: "Closed",
};

const STAGE_TONE: Record<string, { card: string; label: string; badge: string; bar: string; track: string }> = {
  DRAFT: {
    card: "border-slate-200/90 bg-white",
    label: "text-slate-700",
    badge: "bg-slate-100 text-slate-600",
    bar: "bg-slate-400",
    track: "bg-slate-100",
  },
  PENDING_APPROVAL: {
    card: "border-amber-200/90 bg-amber-50/20",
    label: "text-amber-800",
    badge: "bg-amber-100 text-amber-800",
    bar: "bg-amber-500",
    track: "bg-amber-100",
  },
  NEGOTIATION: {
    card: "border-indigo-200/90 bg-indigo-50/20",
    label: "text-indigo-800",
    badge: "bg-indigo-100 text-indigo-800",
    bar: "bg-indigo-600",
    track: "bg-indigo-100",
  },
  APPROVED: {
    card: "border-emerald-200/90 bg-emerald-50/20",
    label: "text-emerald-800",
    badge: "bg-emerald-100 text-emerald-800",
    bar: "bg-emerald-600",
    track: "bg-emerald-100",
  },
  FULFILLMENT: {
    card: "border-slate-200/90 bg-white",
    label: "text-slate-700",
    badge: "bg-slate-100 text-slate-600",
    bar: "bg-slate-600",
    track: "bg-slate-100",
  },
};

export function CommandCentreClient({ data }: { data: CommandCentreData }) {
  const largest = Math.max(1, ...data.pipeline.map((stage) => Number(stage.value)));

  return (
    <AppShell className="screen-command-center mac-desktop-bg font-jakarta text-slate-900 selection:bg-indigo-500 selection:text-white">
      <AppWindow>
        <div className="shrink-0 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-slate-200/80 px-6 py-3.5 bg-white">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className={"font-display " + PAGE_TITLE}>Sales Operations</h1>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-50 text-indigo-700 border border-indigo-100">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5" />
                {data.kpis.activeDeals} active deal{data.kpis.activeDeals === 1 ? "" : "s"}
              </span>
            </div>
            <p className={PAGE_SUBTITLE}>
              Here&apos;s what&apos;s happening across your sales operations.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              className="inline-flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 font-medium px-3 py-1.5 rounded-lg text-xs shadow-xs transition-colors"
              href={ROUTES.approvals}
            >
              Review Approvals
            </Link>
            <Link
              className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs font-semibold px-3 py-1.5 rounded-lg text-xs transition-colors"
              href={ROUTES.sales}
            >
              Open Sales Workspace
            </Link>
          </div>
        </div>

        <WindowScroll className={SCROLL_PADDING}>
          {/* KPI strip */}
          <section className="bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden">
            <div className="grid grid-cols-2 md:grid-cols-5 divide-y md:divide-y-0 md:divide-x divide-slate-100">
              <Kpi
                caption="In flight now"
                href={ROUTES.sales}
                label="Active deals"
                value={String(data.kpis.activeDeals)}
              />
              <Kpi
                caption="Discounts & terms"
                href={ROUTES.approvals}
                label="Pending approvals"
                tone={data.kpis.pendingApprovals > 0 ? "amber" : "slate"}
                value={String(data.kpis.pendingApprovals)}
              />
              <Kpi
                caption={data.kpis.atRisk === null ? "Not available to your role" : "Needs follow-up"}
                href={data.kpis.atRisk === null ? undefined : ROUTES.dealHealth}
                label="At-risk deals"
                tone={data.kpis.atRisk ? "rose" : "slate"}
                value={data.kpis.atRisk === null ? "—" : String(data.kpis.atRisk)}
              />
              <Kpi
                caption="Warehouse allocations"
                href={ROUTES.fulfillment}
                label="In fulfillment"
                value={String(data.kpis.inFulfilment)}
              />
              <Kpi
                caption="Total pipeline value"
                label="Pipeline"
                mono
                value={formatCompact(data.kpis.totalPipeline)}
              />
            </div>
          </section>

          {/* Pipeline */}
          <section className="bg-white border border-slate-200/90 rounded-xl shadow-2xs p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
              <div>
                <h2 className="font-display text-sm font-bold text-slate-900">
                  Sales Pipeline Overview
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {data.pipeline.reduce((sum, stage) => sum + stage.count, 0)} deals ·{" "}
                  {formatCompact(data.kpis.totalPipeline)} in pipeline
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-4">
              {data.pipeline.map((stage) => {
                const tone = STAGE_TONE[stage.stage] ?? STAGE_TONE.DRAFT;
                const width = Math.round((Number(stage.value) / largest) * 100);
                return (
                  <div
                    className={"p-3.5 rounded-lg border transition-all " + tone.card}
                    key={stage.stage}
                  >
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span
                        className={
                          "font-semibold uppercase tracking-wider text-[11px] " + tone.label
                        }
                      >
                        {STAGE_LABEL[stage.stage] ?? stage.stage}
                      </span>
                      <span
                        className={"px-1.5 py-0.5 text-[10px] font-jetbrains font-medium rounded " + tone.badge}
                      >
                        {stage.count}
                      </span>
                    </div>
                    <div className="font-jetbrains text-base font-bold text-slate-900">
                      {formatCompact(stage.value)}
                    </div>
                    <div className={"w-full h-1.5 rounded-full mt-2.5 overflow-hidden " + tone.track}>
                      <div className={"h-full rounded-full " + tone.bar} style={{ width: width + "%" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Recent deals */}
            <div className="lg:col-span-8 bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden">
              <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h2 className="font-display text-sm font-bold text-slate-900">Recent Deals</h2>
                  <p className="text-xs text-slate-500 mt-0.5">Most recently active first</p>
                </div>
                <Link
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                  href={ROUTES.sales}
                >
                  View all →
                </Link>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-50/75 border-b border-slate-100 text-slate-600 text-[10px] font-semibold uppercase tracking-wider">
                    <tr>
                      <th className="py-3 px-5">Deal &amp; Client</th>
                      <th className="py-3 px-3">Ref</th>
                      <th className="py-3 px-3 text-right">Amount</th>
                      <th className="py-3 px-3 text-right">Margin</th>
                      <th className="py-3 px-3">Stage</th>
                      <th className="py-3 px-5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {data.recent.length === 0 ? (
                      <tr>
                        <td className="py-8 px-5 text-center text-slate-500" colSpan={6}>
                          No quotations yet.
                        </td>
                      </tr>
                    ) : (
                      data.recent.map((deal) => {
                        const tone = STAGE_TONE[deal.stage] ?? STAGE_TONE.DRAFT;
                        return (
                          <tr className="hover:bg-slate-50/70 transition-colors" key={deal.id}>
                            <td className="py-3.5 px-5">
                              <div className="font-semibold text-slate-900">{deal.customerName}</div>
                              <div className="text-[11px] text-slate-500">{deal.salesRepName}</div>
                            </td>
                            <td className="py-3.5 px-3 font-jetbrains text-[11px] text-slate-500">
                              {deal.quoteNumber}
                            </td>
                            <td className="py-3.5 px-3 font-jetbrains text-right font-bold text-slate-900">
                              {formatRupees(deal.totalAmount)}
                            </td>
                            <td className="py-3.5 px-3 font-jetbrains text-right text-slate-600">
                              {deal.marginPercentage}%
                            </td>
                            <td className="py-3.5 px-3">
                              <span
                                className={
                                  "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold " +
                                  tone.badge
                                }
                              >
                                {STAGE_LABEL[deal.stage] ?? deal.stage}
                              </span>
                            </td>
                            <td className="py-3.5 px-5 text-right">
                              <Link
                                className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800"
                                href={`/sales?open=${deal.id}`}
                              >
                                Open
                              </Link>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Attention required */}
            <div className="lg:col-span-4 bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden">
              <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between">
                <h2 className="font-display text-sm font-bold text-slate-900">Attention Required</h2>
                <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-50 text-amber-700 rounded border border-amber-200">
                  {data.kpis.pendingApprovals + data.alerts.length + data.expiring.length} items
                </span>
              </div>

              <div className="divide-y divide-slate-100">
                {data.kpis.pendingApprovals > 0 && (
                  <AttentionItem
                    accent="border-amber-500"
                    action="Review Approvals"
                    body="Quotations are waiting on a pricing decision before commercials can be locked."
                    href={ROUTES.approvals}
                    title={`${data.kpis.pendingApprovals} quotation${data.kpis.pendingApprovals === 1 ? "" : "s"} awaiting approval`}
                  />
                )}

                {data.alerts.map((alert) => (
                  <AttentionItem
                    accent="border-rose-500"
                    action="Open"
                    body={alert.message}
                    href={`/sales?open=${alert.quotationId}`}
                    key={alert.quotationId + alert.message}
                    title={alert.customerName}
                  />
                ))}

                {data.expiring.map((row) => (
                  <AttentionItem
                    accent="border-indigo-600"
                    action="Open"
                    body={
                      row.daysLeft <= 0
                        ? `${row.quoteNumber} has passed its validity date.`
                        : `${row.quoteNumber} is valid for ${row.daysLeft} more day${row.daysLeft === 1 ? "" : "s"}.`
                    }
                    href={`/sales?open=${row.id}`}
                    key={row.id}
                    title={`${row.customerName} — quotation expiring`}
                  />
                ))}

                {data.kpis.pendingApprovals === 0 &&
                  data.alerts.length === 0 &&
                  data.expiring.length === 0 && (
                    <p className="p-5 text-xs text-slate-500">
                      Nothing needs attention. No approvals are outstanding, no alerts are open and
                      no quotation is close to expiring.
                    </p>
                  )}
              </div>
            </div>
          </section>
        </WindowScroll>

        <StatusBar />
      </AppWindow>

      <AppDock />
      <AgentButton />
    </AppShell>
  );
}

function Kpi({
  label,
  value,
  caption,
  tone = "slate",
  href,
  mono,
}: {
  label: string;
  value: string;
  caption: string;
  tone?: "slate" | "amber" | "rose";
  href?: string;
  mono?: boolean;
}) {
  const colour = {
    slate: "text-slate-900",
    amber: "text-amber-600",
    rose: "text-rose-600",
  }[tone];

  const body = (
    <>
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <div className="mt-2 flex items-baseline gap-2">
        <span
          className={
            "text-xl font-bold tracking-tight " + colour + (mono ? " font-jetbrains" : " font-jetbrains")
          }
        >
          {value}
        </span>
      </div>
      <span className="text-[11px] text-slate-400 mt-1 block font-medium">{caption}</span>
    </>
  );

  if (!href) return <div className="p-4 sm:p-5">{body}</div>;

  return (
    <Link className="p-4 sm:p-5 hover:bg-slate-50/60 transition-colors block" href={href}>
      {body}
    </Link>
  );
}

function AttentionItem({
  accent,
  title,
  body,
  action,
  href,
}: {
  accent: string;
  title: string;
  body: string;
  action: string;
  href: string;
}) {
  return (
    <div
      className={
        "p-4 sm:p-5 hover:bg-slate-50/70 transition-colors flex flex-col gap-2 border-l-[3.5px] " +
        accent
      }
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-xs font-semibold text-slate-900 leading-snug">{title}</h3>
        <Link
          className="px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors shrink-0 shadow-xs"
          href={href}
        >
          {action}
        </Link>
      </div>
      <p className="text-[11px] text-slate-500 leading-relaxed">{body}</p>
    </div>
  );
}
