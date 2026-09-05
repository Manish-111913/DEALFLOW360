"use client";

/**
 * The deal-health table rows.
 *
 * These used to be a hardcoded array of seven deals copied out of the Stitch
 * screen. They now come from GET /api/deal-health, which is
 * `getDealHealthDashboard` - capability-checked and row-scoped, so a manager
 * and a finance user genuinely see different rows.
 *
 * The presentation tables below map the backend's four severities and four
 * alert types onto the screen's colours. They are exhaustive `Record`s rather
 * than lookups with a fallback, so adding a severity or an alert type to the
 * schema fails the build here instead of rendering an unstyled row.
 */

export type DealSeverity = "HEALTHY" | "WATCH" | "AT_RISK" | "CRITICAL";
export type AlertType = "STALLED" | "DISCOUNT_ANOMALY" | "DELIVERY_SLIPPAGE" | "APPROVAL_DELAY";

/** The payload of GET /api/deal-health, one row per live deal. */
export interface HealthRow {
  quotationId: string;
  quoteNumber: string;
  customerName: string;
  salesRepName: string;
  healthScore: number;
  severity: DealSeverity;
  recommendedAction: string;
  stalledDays: number;
  computedAt: string;
  openAlerts: { id: string; type: AlertType; message: string }[];
}

const SEVERITY: Record<
  DealSeverity,
  { label: string; pill: string; bar: string; score: string }
> = {
  CRITICAL: {
    label: "Critical",
    pill: "bg-red-50 text-red-700 border-red-200",
    bar: "bg-red-500",
    score: "text-red-600",
  },
  AT_RISK: {
    label: "At Risk",
    pill: "bg-amber-50 text-amber-700 border-amber-200",
    bar: "bg-amber-500",
    score: "text-amber-600",
  },
  WATCH: {
    label: "Watch",
    pill: "bg-indigo-50 text-indigo-700 border-indigo-200",
    bar: "bg-indigo-500",
    score: "text-indigo-600",
  },
  HEALTHY: {
    label: "Healthy",
    pill: "bg-emerald-50 text-emerald-700 border-emerald-200",
    bar: "bg-emerald-500",
    score: "text-emerald-600",
  },
};

const ALERT: Record<AlertType, { label: string; style: string }> = {
  STALLED: { label: "🔴 Stalled Deal", style: "text-red-600 font-semibold" },
  DELIVERY_SLIPPAGE: { label: "🔴 Delivery Slippage", style: "text-red-600 font-semibold" },
  APPROVAL_DELAY: { label: "⚠️ Approval Delay", style: "text-amber-700 font-semibold" },
  DISCOUNT_ANOMALY: { label: "ℹ️ Discount Anomaly", style: "text-indigo-600 font-semibold" },
};

const NO_ALERT = { label: "✓ Normal Velocity", style: "text-emerald-600 font-medium" };

/** "5 days ago" / "today", from the stalled-day count the scorer produced. */
function lastActivity(days: number): string {
  if (days <= 0) return "today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

export function DealHealthRow({
  row,
  selected,
  onSelect,
}: {
  row: HealthRow;
  /** The row whose detail the drawer is showing. */
  selected: boolean;
  onSelect: (row: HealthRow) => void;
}) {
  const severity = SEVERITY[row.severity];
  // The dashboard returns every open alert; the table has room for the leading
  // one and the drawer shows the rest.
  const primary = row.openAlerts[0];
  const issue = primary ? ALERT[primary.type] : NO_ALERT;

  const cell = selected ? "py-3.5 px-3" : "py-3 px-3";
  const firstCell = selected ? "py-3.5 px-3.5" : "py-3 px-3.5";

  return (
    <tr
      className={
        "cursor-pointer transition-colors " +
        (selected
          ? "bg-indigo-50/40 border-l-4 border-indigo-600"
          : "hover:bg-slate-50/70")
      }
      onClick={() => onSelect(row)}
    >
      <td className={firstCell}>
        {selected ? (
          <div className="flex items-center space-x-2">
            <div className="font-bold text-slate-900">{row.customerName}</div>
            <span className="inline-block px-1.5 py-0.2 bg-indigo-100 text-indigo-700 font-semibold text-[9px] rounded">
              Selected
            </span>
          </div>
        ) : (
          <div className="font-semibold text-slate-900">{row.customerName}</div>
        )}
        <div className="text-[11px] text-slate-500">{row.salesRepName}</div>
      </td>

      <td
        className={
          cell +
          " font-jetbrains text-[11px] " +
          (selected ? "font-semibold text-indigo-700" : "text-slate-600")
        }
      >
        {row.quoteNumber}
      </td>

      <td className={cell}>
        <div className="flex items-center space-x-2">
          <div
            className={
              "w-16 rounded-full h-1.5 overflow-hidden " + (selected ? "bg-slate-200" : "bg-slate-100")
            }
          >
            <div
              className={"h-1.5 rounded-full " + severity.bar}
              style={{ width: Math.max(0, Math.min(100, row.healthScore)) + "%" }}
            />
          </div>
          <span className={"font-bold " + severity.score}>{row.healthScore}</span>
          <span className="text-slate-400 text-[10px]">/100</span>
        </div>
      </td>

      <td className={cell}>
        <span
          className={
            "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border " +
            severity.pill
          }
        >
          {severity.label}
        </span>
      </td>

      <td className={cell + " font-medium " + (selected ? "text-slate-800" : "text-slate-700")}>
        <span className={"inline-flex items-center " + issue.style}>{issue.label}</span>
        <span className="block text-[11px] font-normal text-slate-500">
          {primary ? primary.message : "Within SLA thresholds"}
        </span>
      </td>

      <td className={cell}>
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700">
          {row.openAlerts.length} open
        </span>
      </td>

      <td className={cell + (selected ? " text-slate-600 font-medium" : " text-slate-500")}>
        {lastActivity(row.stalledDays)}
      </td>

      <td className={cell + " text-right"}>
        <button
          className={
            "px-2.5 py-1 rounded font-medium text-xs transition-colors " +
            (selected
              ? "bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs"
              : "bg-slate-100 hover:bg-slate-200 text-slate-700")
          }
          onClick={(event) => {
            event.stopPropagation();
            onSelect(row);
          }}
          type="button"
        >
          {selected ? "Reviewing" : "Review"}
        </button>
      </td>
    </tr>
  );
}

export { SEVERITY, ALERT, lastActivity };
