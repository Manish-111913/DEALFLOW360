"use client";

/**
 * The seven rows of the deal-health table.
 *
 * Acme Industries is the "selected" row: indigo tint, a left rule, an extra
 * badge, slightly taller padding and a filled "Reviewing" button rather than the
 * grey "Review". It is the deal the drawer on the right describes, which is why
 * it reads differently from the rest.
 */

export interface HealthRow {
  customer: string;
  detail: string;
  reference: string;
  score: number;
  /** Colour of the score bar and number, per severity. */
  bar: string;
  scoreText: string;
  severity: string;
  severityStyle: string;
  issue: string;
  issueStyle: string;
  issueDetail: string;
  issueDetailStyle: string;
  stage: string;
  /** The selected row shows its stage as a pill instead of plain text. */
  stagePill?: boolean;
  activity: string;
  action: string;
  actionStyle: string;
  selected?: boolean;
}

export const HEALTH_ROWS: HealthRow[] = [
  {
    customer: "Nova Systems",
    detail: "Managed Support Contract",
    reference: "DF-2024-1065",
    score: 31,
    bar: "bg-red-500",
    scoreText: "text-red-600",
    severity: "Critical",
    severityStyle: "bg-red-50 text-red-700 border-red-200",
    issue: "🔴 Delivery Slippage",
    issueStyle: "text-red-600 font-semibold",
    issueDetail: "Server rack lead time delay",
    issueDetailStyle: "text-slate-500",
    stage: "Fulfillment",
    activity: "6 days ago",
    action: "Review",
    actionStyle: "bg-slate-100 hover:bg-slate-200 text-slate-700",
  },
  {
    customer: "Apex Global",
    detail: "Regional Cloud Infrastructure",
    reference: "DF-2024-1063",
    score: 36,
    bar: "bg-red-500",
    scoreText: "text-red-600",
    severity: "Critical",
    severityStyle: "bg-red-50 text-red-700 border-red-200",
    issue: "🔴 Open Backorder",
    issueStyle: "text-red-600 font-semibold",
    issueDetail: "5 units backordered in main hub",
    issueDetailStyle: "text-slate-500",
    stage: "Fulfillment",
    activity: "1 day ago",
    action: "Review",
    actionStyle: "bg-slate-100 hover:bg-slate-200 text-slate-700",
  },
  {
    customer: "Acme Industries",
    detail: "Cloud Migration & ERP",
    reference: "DF-2024-1082",
    score: 57,
    bar: "bg-amber-500",
    scoreText: "text-amber-600",
    severity: "At Risk",
    severityStyle: "bg-amber-50 text-amber-700 border-amber-200",
    issue: "⚠️ Stalled + Negotiation",
    issueStyle: "text-amber-700 font-semibold",
    issueDetail: "5d without client signoff",
    issueDetailStyle: "text-slate-500",
    stage: "Under Negotiation",
    stagePill: true,
    activity: "5 days ago",
    action: "Reviewing",
    actionStyle: "bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs",
    selected: true,
  },
  {
    customer: "Beta Industries",
    detail: "Supply Chain Logistics API",
    reference: "DF-2024-1078",
    score: 42,
    bar: "bg-amber-500",
    scoreText: "text-amber-600",
    severity: "At Risk",
    severityStyle: "bg-amber-50 text-amber-700 border-amber-200",
    issue: "⚠️ Approval Delay",
    issueStyle: "text-amber-700 font-semibold",
    issueDetail: "VP signoff pending 48h (Discount >12%)",
    issueDetailStyle: "text-slate-500",
    stage: "Pending Approval",
    activity: "2 days ago",
    action: "Review",
    actionStyle: "bg-slate-100 hover:bg-slate-200 text-slate-700",
  },
  {
    customer: "Zenith Retail",
    detail: "Omnichannel POS Rollout",
    reference: "DF-2024-1064",
    score: 74,
    bar: "bg-indigo-500",
    scoreText: "text-indigo-600",
    severity: "Watch",
    severityStyle: "bg-indigo-50 text-indigo-700 border-indigo-200",
    issue: "ℹ️ Discount Anomaly",
    issueStyle: "text-indigo-600 font-semibold",
    issueDetail: "18% on Setup Service line",
    issueDetailStyle: "text-slate-500",
    stage: "Negotiation",
    activity: "1 day ago",
    action: "Review",
    actionStyle: "bg-slate-100 hover:bg-slate-200 text-slate-700",
  },
  {
    customer: "Omnicorp Labs",
    detail: "AI Inference Cluster",
    reference: "DF-2024-1059",
    score: 78,
    bar: "bg-indigo-500",
    scoreText: "text-indigo-600",
    severity: "Watch",
    severityStyle: "bg-indigo-50 text-indigo-700 border-indigo-200",
    issue: "ℹ️ Negotiation Delay",
    issueStyle: "text-indigo-600 font-semibold",
    issueDetail: "Counter-terms review on Clause 14",
    issueDetailStyle: "text-slate-500",
    stage: "Draft",
    activity: "2 days ago",
    action: "Review",
    actionStyle: "bg-slate-100 hover:bg-slate-200 text-slate-700",
  },
  {
    customer: "Orion Technologies",
    detail: "Enterprise Cloud Hosting",
    reference: "DF-2024-1060",
    score: 89,
    bar: "bg-emerald-500",
    scoreText: "text-emerald-600",
    severity: "Healthy",
    severityStyle: "bg-emerald-50 text-emerald-700 border-emerald-200",
    issue: "✓ Normal Velocity",
    issueStyle: "text-emerald-600 font-medium",
    issueDetail: "Within SLA thresholds",
    issueDetailStyle: "text-slate-400",
    stage: "Approved",
    activity: "2h ago",
    action: "View",
    actionStyle: "bg-slate-100 hover:bg-slate-200 text-slate-700",
  },
];

export function DealHealthRow({ row }: { row: HealthRow }) {
  const cell = row.selected ? "py-3.5 px-3" : "py-3 px-3";
  const firstCell = row.selected ? "py-3.5 px-3.5" : "py-3 px-3.5";

  return (
    <tr
      className={
        row.selected
          ? "bg-indigo-50/40 border-l-4 border-indigo-600 transition-colors"
          : "hover:bg-slate-50/70 transition-colors"
      }
    >
      <td className={firstCell}>
        {row.selected ? (
          <div className="flex items-center space-x-2">
            <div className="font-bold text-slate-900">{row.customer}</div>
            <span className="inline-block px-1.5 py-0.2 bg-indigo-100 text-indigo-700 font-semibold text-[9px] rounded">
              Selected
            </span>
          </div>
        ) : (
          <div className="font-semibold text-slate-900">{row.customer}</div>
        )}
        <div className="text-[11px] text-slate-500">{row.detail}</div>
      </td>

      <td
        className={
          cell +
          " font-mono text-[11px] " +
          (row.selected ? "font-semibold text-indigo-700" : "text-slate-600")
        }
      >
        {row.reference}
      </td>

      <td className={cell}>
        <div className="flex items-center space-x-2">
          <div
            className={
              "w-16 rounded-full h-1.5 overflow-hidden " +
              (row.selected ? "bg-slate-200" : "bg-slate-100")
            }
          >
            <div className={"h-1.5 rounded-full " + row.bar} style={{ width: row.score + "%" }} />
          </div>
          <span className={"font-bold " + row.scoreText}>{row.score}</span>
          <span className="text-slate-400 text-[10px]">/100</span>
        </div>
      </td>

      <td className={cell}>
        <span
          className={
            "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border " +
            row.severityStyle
          }
        >
          {row.severity}
        </span>
      </td>

      <td className={cell + " font-medium " + (row.selected ? "text-slate-800" : "text-slate-700")}>
        <span className={"inline-flex items-center " + row.issueStyle}>{row.issue}</span>
        <span className={"block text-[11px] font-normal " + row.issueDetailStyle}>
          {row.issueDetail}
        </span>
      </td>

      <td className={cell}>
        {row.stagePill ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700">
            {row.stage}
          </span>
        ) : (
          <span className="text-slate-700 font-medium">{row.stage}</span>
        )}
      </td>

      <td className={cell + (row.selected ? " text-slate-600 font-medium" : " text-slate-500")}>
        {row.activity}
      </td>

      <td className={cell + " text-right"}>
        <button
          className={"px-2.5 py-1 rounded font-medium text-xs transition-colors " + row.actionStyle}
          type="button"
        >
          {row.action}
        </button>
      </td>
    </tr>
  );
}
