"use client";

import { useMemo, useState, useTransition } from "react";
import { AgentButton, AppShell, AppWindow, StatusBar } from "@/components/app-shell";
import { AppDock } from "@/components/app-dock";
import { CHROME_BAR, PAGE_SUBTITLE, PAGE_TITLE, SCROLL_PADDING } from "@/components/design-tokens";
import { ToastProvider, useToast, useToastState } from "@/components/toast";
import {
  ALERT,
  DealHealthRow,
  SEVERITY,
  lastActivity,
  type DealSeverity,
  type HealthRow,
} from "./deal-rows";

/**
 * The interactive half of the Deal Health screen.
 *
 * The server component has already fetched and authorised the rows, so this
 * starts with real data rather than a loading state. It re-fetches through
 * /api/deal-health only after an escalation, which is the one action that
 * changes the board.
 *
 * `denied` is passed rather than inferred: a SALES_REP has no dealHealth
 * capability, and an empty table would read as "no deals need attention" -
 * a very different and much worse message than "you cannot see this".
 */

const SEVERITY_ORDER: DealSeverity[] = ["CRITICAL", "AT_RISK", "WATCH", "HEALTHY"];

const KPI_STYLES: Record<
  DealSeverity,
  { card: string; label: string; value: string; note: string; dot: string; caption: string }
> = {
  CRITICAL: {
    card: "bg-red-50/50 border-red-200",
    label: "text-red-700",
    value: "text-red-700",
    note: "text-red-600 font-medium",
    dot: "bg-red-500",
    caption: "Immediate action",
  },
  AT_RISK: {
    card: "bg-amber-50/50 border-amber-200 ring-1 ring-amber-400/20",
    label: "text-amber-800",
    value: "text-amber-800",
    note: "text-amber-700 font-medium",
    dot: "bg-amber-500",
    caption: "Needs triage",
  },
  WATCH: {
    card: "bg-indigo-50/40 border-indigo-200",
    label: "text-indigo-700",
    value: "text-indigo-700",
    note: "text-indigo-600 font-medium",
    dot: "bg-indigo-500",
    caption: "Minor anomalies",
  },
  HEALTHY: {
    card: "bg-emerald-50/40 border-emerald-200 col-span-2 sm:col-span-1",
    label: "text-emerald-800",
    value: "text-emerald-800",
    note: "text-emerald-600 font-medium",
    dot: "bg-emerald-500",
    caption: "On track",
  },
};

export function DealHealthClient({
  initialRows,
  denied,
}: {
  initialRows: HealthRow[];
  denied: boolean;
}) {
  return (
    <ToastProvider durationMs={3000}>
      <Board denied={denied} initialRows={initialRows} />
    </ToastProvider>
  );
}

function Board({ initialRows, denied }: { initialRows: HealthRow[]; denied: boolean }) {
  const showToast = useToast();
  const [rows, setRows] = useState(initialRows);
  const [selectedId, setSelectedId] = useState<string | null>(initialRows[0]?.quotationId ?? null);
  const [severityFilter, setSeverityFilter] = useState<DealSeverity | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [busy, startTransition] = useTransition();
  const [escalated, setEscalated] = useState<string[]>([]);

  const counts = useMemo(() => {
    const base: Record<DealSeverity, number> = { CRITICAL: 0, AT_RISK: 0, WATCH: 0, HEALTHY: 0 };
    for (const row of rows) base[row.severity] += 1;
    return base;
  }, [rows]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (severityFilter !== "ALL" && row.severity !== severityFilter) return false;
      if (!term) return true;
      return (
        row.customerName.toLowerCase().includes(term) ||
        row.quoteNumber.toLowerCase().includes(term) ||
        row.salesRepName.toLowerCase().includes(term)
      );
    });
  }, [rows, severityFilter, search]);

  const selected = rows.find((row) => row.quotationId === selectedId) ?? null;

  async function reload() {
    const response = await fetch("/api/deal-health", { cache: "no-store" });
    if (!response.ok) return;
    const body = (await response.json()) as { rows: HealthRow[] };
    setRows(body.rows);
  }

  function escalate(row: HealthRow) {
    startTransition(async () => {
      const response = await fetch("/api/deal-health/escalate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quotationId: row.quotationId }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        showToast(body.error ?? "Escalation failed");
        return;
      }
      setEscalated((current) => [...current, row.quotationId]);
      showToast(`Escalation created for ${row.customerName}`);
      // The escalation writes an alert, so the board it came from has changed.
      await reload();
    });
  }

  return (
    <AppShell className="screen-deal-health font-jakarta bg-[#f0f4f8] text-slate-800 select-none">
      <AppWindow>
        <header className={CHROME_BAR + " gap-4"}>
          <div className="flex items-center space-x-3.5">
            <div aria-hidden="true" className="flex items-center space-x-1.5">
              <span className="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] inline-block shadow-sm" />
              <span className="w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#dea123] inline-block shadow-sm" />
              <span className="w-3 h-3 rounded-full bg-[#27c93f] border border-[#1aab29] inline-block shadow-sm" />
            </div>
            <div className="h-4 w-px bg-slate-300 mx-1" />
            <div className="flex items-center text-xs font-medium text-slate-600 space-x-1.5">
              <span className="text-slate-500">Sales Operations</span>
              <span className="text-slate-400">/</span>
              <span className="text-indigo-600 font-semibold bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100">
                Deal Health &amp; Anomaly Engine
              </span>
            </div>
          </div>
        </header>

        <main className="flex-1 min-h-0 overflow-hidden flex flex-row relative bg-[#fcfdfe]">
          <section
            className={"flex-1 min-h-0 overflow-y-auto app-scroll flex flex-col pb-28 " + SCROLL_PADDING}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/80 pb-4">
              <div>
                <div className="flex items-center space-x-2.5">
                  <h1 className={PAGE_TITLE}>Deal Health</h1>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                    Live Telemetry
                  </span>
                </div>
                <p className={PAGE_SUBTITLE}>
                  Monitor deals that need attention before they lose momentum.
                </p>
              </div>

              {!denied && (
                <button
                  className="inline-flex items-center px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 shadow-xs transition-colors disabled:opacity-60"
                  disabled={busy}
                  onClick={() =>
                    startTransition(async () => {
                      await reload();
                      showToast("Health telemetry refreshed");
                    })
                  }
                  type="button"
                >
                  Refresh
                </button>
              )}
            </div>

            {denied ? (
              <div className="bg-white border border-slate-200/90 rounded-xl shadow-2xs p-6 text-center">
                <p className="text-sm font-bold text-slate-900">Not available for your role</p>
                <p className="text-xs text-slate-500 mt-1">
                  The deal health board is restricted to Sales Managers, Finance / Operations and
                  Admins. Sign in as one of those to review it.
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div className="bg-white border border-slate-200/90 rounded-xl p-3 flex flex-col justify-between shadow-2xs">
                    <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                      Total Active
                    </span>
                    <div className="flex items-baseline justify-between mt-1">
                      <span className="text-xl font-bold text-slate-900">{rows.length}</span>
                      <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded font-medium">
                        In scope
                      </span>
                    </div>
                  </div>

                  {SEVERITY_ORDER.map((severity) => {
                    const style = KPI_STYLES[severity];
                    return (
                      <button
                        className={
                          "border rounded-xl p-3 flex flex-col justify-between shadow-2xs text-left transition-all " +
                          style.card +
                          (severityFilter === severity ? " ring-2 ring-indigo-400" : "")
                        }
                        key={severity}
                        onClick={() =>
                          setSeverityFilter((current) => (current === severity ? "ALL" : severity))
                        }
                        type="button"
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={"text-[11px] font-semibold uppercase tracking-wider " + style.label}
                          >
                            {SEVERITY[severity].label}
                          </span>
                          <span className={"w-2 h-2 rounded-full " + style.dot} />
                        </div>
                        <div className="flex items-baseline justify-between mt-1">
                          <span className={"text-xl font-bold " + style.value}>{counts[severity]}</span>
                          <span className={"text-[10px] " + style.note}>{style.caption}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="bg-white border border-slate-200/90 rounded-xl p-2.5 shadow-2xs space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2.5">
                    <div className="relative flex-1 min-w-[220px]">
                      <input
                        className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-700 placeholder-slate-400"
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search deals, customers, quotations..."
                        value={search}
                      />
                    </div>
                    <button
                      className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 px-2.5 py-1.5 rounded-lg font-medium transition-colors"
                      onClick={() => {
                        setSearch("");
                        setSeverityFilter("ALL");
                      }}
                      type="button"
                    >
                      Reset
                    </button>
                  </div>

                  <div className="flex items-center space-x-1 pt-1 border-t border-slate-100 text-xs overflow-x-auto">
                    <button
                      className={
                        "px-2.5 py-1 rounded-md font-semibold transition-colors " +
                        (severityFilter === "ALL"
                          ? "bg-slate-900 text-white shadow-xs"
                          : "text-slate-600 hover:bg-slate-100")
                      }
                      onClick={() => setSeverityFilter("ALL")}
                      type="button"
                    >
                      All Deals ({rows.length})
                    </button>
                    {SEVERITY_ORDER.map((severity) => (
                      <button
                        className={
                          "px-2.5 py-1 rounded-md font-medium transition-colors flex items-center space-x-1 " +
                          (severityFilter === severity
                            ? "bg-slate-900 text-white"
                            : "text-slate-600 hover:bg-slate-100")
                        }
                        key={severity}
                        onClick={() => setSeverityFilter(severity)}
                        type="button"
                      >
                        <span className={"w-2 h-2 rounded-full " + KPI_STYLES[severity].dot} />
                        <span>
                          {SEVERITY[severity].label} ({counts[severity]})
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Not `flex-1`. This card sits in a scrolling flex column, and
                    flex-1 sets flex-basis:0 - so the card took whatever space
                    was left over rather than the height of its rows, and
                    overflow-hidden (which is here to clip the rounded corners)
                    cut the table off mid-row. Content height is correct: the
                    parent already scrolls when the list is long. */}
                <div className="bg-white border border-slate-200/90 rounded-xl shadow-2xs overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                      <thead className="bg-slate-50/75 border-b border-slate-100 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">
                        <tr>
                          <th className="py-3 px-3.5" scope="col">Deal &amp; Customer</th>
                          <th className="py-3 px-3" scope="col">Reference</th>
                          <th className="py-3 px-3" scope="col">Health Score</th>
                          <th className="py-3 px-3" scope="col">Severity</th>
                          <th className="py-3 px-3" scope="col">Primary Issue</th>
                          <th className="py-3 px-3" scope="col">Alerts</th>
                          <th className="py-3 px-3" scope="col">Last Activity</th>
                          <th className="py-3 px-3 text-right" scope="col">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {visible.length === 0 ? (
                          <tr>
                            <td
                              className="py-8 px-3.5 text-center text-xs text-slate-500"
                              colSpan={8}
                            >
                              {rows.length === 0
                                ? "No live deals in scope. Every deal is either confirmed or cancelled."
                                : "No deals match this filter."}
                            </td>
                          </tr>
                        ) : (
                          visible.map((row) => (
                            <DealHealthRow
                              key={row.quotationId}
                              onSelect={(next) => setSelectedId(next.quotationId)}
                              row={row}
                              selected={row.quotationId === selectedId}
                            />
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="px-4 py-2.5 border-t border-slate-200/80 bg-slate-50/60 flex items-center justify-between text-xs text-slate-500">
                    <span>
                      Showing {visible.length} of {rows.length} live deals sorted by severity
                    </span>
                  </div>
                </div>
              </>
            )}
          </section>

          <aside className="w-80 md:w-96 border-l border-slate-200 bg-white flex flex-col justify-between shrink-0 shadow-lg z-10 overflow-y-auto app-scroll pb-28">
            {selected ? (
              <DealDrawer
                busy={busy}
                escalated={escalated.includes(selected.quotationId)}
                onEscalate={() => escalate(selected)}
                row={selected}
              />
            ) : (
              <div className="p-4 text-xs text-slate-500">
                {denied ? "Unavailable for your role." : "Select a deal to see its breakdown."}
              </div>
            )}
          </aside>
        </main>

        <StatusBar />
        <HealthToast />
      </AppWindow>

      <AppDock />
      <AgentButton />
    </AppShell>
  );
}

function DealDrawer({
  row,
  busy,
  escalated,
  onEscalate,
}: {
  row: HealthRow;
  busy: boolean;
  escalated: boolean;
  onEscalate: () => void;
}) {
  const severity = SEVERITY[row.severity];

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between border-b border-slate-100 pb-3">
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-sm font-bold text-slate-900">{row.customerName}</h2>
            <span className="text-[10px] font-jetbrains bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
              {row.quoteNumber}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">{row.salesRepName}</p>
        </div>
        <span
          className={
            "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border " +
            severity.pill
          }
        >
          {severity.label}
        </span>
      </div>

      <div className="bg-gradient-to-br from-amber-50/60 to-orange-50/30 rounded-xl p-3.5 border border-amber-200/80">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold uppercase text-amber-800 tracking-wide">
              Health Telemetry
            </span>
            <div className="flex items-baseline space-x-1 mt-0.5">
              <span className="text-3xl font-extrabold text-amber-700">{row.healthScore}</span>
              <span className="text-xs font-semibold text-slate-500">/ 100</span>
            </div>
          </div>
          <div className="relative w-14 h-14 flex items-center justify-center">
            <svg className="w-14 h-14 transform -rotate-90" viewBox="0 0 36 36">
              <path
                className="text-slate-200"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="currentColor"
                strokeWidth="3.5"
              />
              <path
                className="text-amber-500"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="currentColor"
                strokeDasharray={row.healthScore + ", 100"}
                strokeLinecap="round"
                strokeWidth="3.5"
              />
            </svg>
            <span className="absolute text-[10px] font-bold text-amber-800">{row.healthScore}%</span>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-amber-200/60 text-[11px] text-slate-600">
          Last activity <strong className="text-slate-800">{lastActivity(row.stalledDays)}</strong>
        </div>
      </div>

      <div className="space-y-2">
        <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block">
          Open Alerts ({row.openAlerts.length})
        </span>
        <div className="space-y-1.5 text-xs">
          {row.openAlerts.length === 0 ? (
            <p className="text-xs text-slate-500">No open alerts on this deal.</p>
          ) : (
            row.openAlerts.map((alert) => (
              <div
                className="flex items-start justify-between gap-2 p-2 rounded-lg bg-slate-50 border border-slate-200/80"
                key={alert.id}
              >
                <span className={"font-medium shrink-0 " + ALERT[alert.type].style}>
                  {ALERT[alert.type].label}
                </span>
                <span className="text-[11px] text-slate-500 text-right">{alert.message}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="bg-indigo-50/70 border border-indigo-200 rounded-xl p-3.5 space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-900">
          Recommended Action
        </h3>
        <p className="text-xs text-slate-700 leading-relaxed">{row.recommendedAction}</p>
        <div className="flex items-center space-x-2 pt-1">
          <button
            className={
              "flex-1 px-3 py-2 text-white rounded-lg text-xs font-semibold shadow-xs transition-all disabled:opacity-60 " +
              (escalated ? "bg-emerald-600" : "bg-indigo-600 hover:bg-indigo-700")
            }
            disabled={busy || escalated}
            onClick={onEscalate}
            type="button"
          >
            {escalated ? "Escalated" : busy ? "Working…" : "Escalate"}
          </button>
        </div>
      </div>
    </div>
  );
}

function HealthToast() {
  const { message, visible } = useToastState();
  return (
    <div
      className={
        "absolute top-14 right-6 z-50 transition-all duration-300 transform " +
        (visible ? "opacity-100 translate-y-0" : "opacity-0 pointer-events-none translate-y-[-10px]")
      }
    >
      <div className="bg-slate-900 text-white text-xs font-medium px-4 py-2.5 rounded-lg shadow-xl flex items-center space-x-2 border border-slate-700">
        <span>{message}</span>
      </div>
    </div>
  );
}
