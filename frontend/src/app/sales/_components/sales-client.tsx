"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  AgentButton,
  AppShell,
  AppWindow,
  StatusBar,
} from "@/components/app-shell";
import { AppDock } from "@/components/app-dock";
import { CHROME_BAR, PAGE_SUBTITLE, PAGE_TITLE } from "@/components/design-tokens";
import { ToastProvider, useToastState } from "@/components/toast";
import { formatCompact, formatRupees } from "@/lib/money";
import { QuotationBuilder } from "./quotation-builder";
import type { BuilderData, DealRow, PipelineStage, PipelineSummary } from "./types";

/**
 * Screen 2 - the Sales Workspace, on live data.
 *
 * The board and the list are two views of the same scoped rows, so they cannot
 * disagree: switching between Board and List re-renders the same array. The
 * stage of a deal is derived on the server from status plus approval state,
 * because the schema keeps those separate and the board is a single ladder.
 */

const STAGE_LABEL: Record<PipelineStage, string> = {
  DRAFT: "01 Draft",
  PENDING_APPROVAL: "02 Pending Approval",
  NEGOTIATION: "03 Under Negotiation",
  APPROVED: "04 Approved",
  FULFILLMENT: "05 Fulfillment",
  CLOSED: "Closed",
};

const STAGE_TONE: Record<PipelineStage, { dot: string; badge: string; pill: string }> = {
  DRAFT: {
    dot: "bg-blue-500",
    badge: "bg-blue-100 text-blue-700",
    pill: "bg-blue-50 text-blue-700 border-blue-200",
  },
  PENDING_APPROVAL: {
    dot: "bg-amber-500",
    badge: "bg-amber-100 text-amber-700",
    pill: "bg-amber-50 text-amber-700 border-amber-200",
  },
  NEGOTIATION: {
    dot: "bg-indigo-500",
    badge: "bg-indigo-100 text-indigo-700",
    pill: "bg-indigo-50 text-indigo-700 border-indigo-200",
  },
  APPROVED: {
    dot: "bg-emerald-500",
    badge: "bg-emerald-100 text-emerald-700",
    pill: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  FULFILLMENT: {
    dot: "bg-slate-600",
    badge: "bg-slate-200 text-slate-700",
    pill: "bg-slate-100 text-slate-700 border-slate-200",
  },
  CLOSED: {
    dot: "bg-slate-400",
    badge: "bg-slate-100 text-slate-600",
    pill: "bg-slate-100 text-slate-600 border-slate-200",
  },
};

/** The five columns the board shows; CLOSED is deliberately not one of them. */
const BOARD_STAGES: PipelineStage[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "NEGOTIATION",
  "APPROVED",
  "FULFILLMENT",
];

type View = "board" | "list";

export function SalesClient({
  rows,
  pipeline,
  builder,
}: {
  rows: DealRow[];
  pipeline: PipelineSummary;
  builder: BuilderData | null;
}) {
  return (
    <ToastProvider>
      <Workspace builder={builder} pipeline={pipeline} rows={rows} />
    </ToastProvider>
  );
}

function Workspace({
  rows,
  pipeline,
  builder,
}: {
  rows: DealRow[];
  pipeline: PipelineSummary;
  builder: BuilderData | null;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>("board");
  const [search, setSearch] = useState("");
  const [busy, startTransition] = useTransition();

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (row) =>
        row.customerName.toLowerCase().includes(term) ||
        row.quoteNumber.toLowerCase().includes(term) ||
        row.salesRepName.toLowerCase().includes(term),
    );
  }, [rows, search]);

  function openBuilder(id: string) {
    startTransition(() => router.push(`/sales?open=${id}`));
  }

  return (
    <AppShell className="screen-workspace font-jakarta text-slate-900 select-none bg-slate-100">
      <AppWindow>
        <div className={CHROME_BAR}>
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2">
              <span className="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] inline-block" />
              <span className="w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#dea123] inline-block" />
              <span className="w-3 h-3 rounded-full bg-[#27c93f] border border-[#1aab29] inline-block" />
            </div>
            <span className="text-slate-300 font-light">|</span>
            <span className="text-xs font-medium text-slate-600">Sales Workspace</span>
          </div>
          <div className="text-[11px] text-slate-500">
            {pipeline.totalDeals} deals · {formatCompact(pipeline.totalValue)}
          </div>
        </div>

        {/* Title + view switcher */}
        <div className="shrink-0 border-b border-slate-200/80 px-6 pt-3.5 bg-white">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center space-x-2.5">
                <h1 className={PAGE_TITLE}>Sales Workspace</h1>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                  Active Cycle
                </span>
              </div>
              <p className={PAGE_SUBTITLE}>
                Manage quotations, build pricing bundles, and follow deal progression across sales
                operations.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between mt-3 text-xs">
            <div className="flex items-center space-x-6">
              <TabButton
                active={view === "list"}
                badge={String(rows.length)}
                label="Quotations"
                onClick={() => setView("list")}
              />
              <TabButton
                active={view === "board"}
                badge={`${BOARD_STAGES.length} Stages`}
                label="Pipeline"
                onClick={() => setView("board")}
              />
            </div>

            <div className="flex items-center space-x-1 pb-1.5">
              <div className="inline-flex items-center bg-slate-100 p-0.5 rounded-lg text-[11px] font-medium text-slate-600">
                <SwitchButton active={view === "board"} label="Board" onClick={() => setView("board")} />
                <SwitchButton active={view === "list"} label="List" onClick={() => setView("list")} />
              </div>
            </div>
          </div>
        </div>

        {/* Summary + search */}
        <div className="shrink-0 border-b border-slate-200/80 px-6 py-2.5 bg-slate-50/70">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center flex-wrap gap-2 text-[11px]">
              {pipeline.stages.map((stage) => {
                const tone = STAGE_TONE[stage.stage as PipelineStage] ?? STAGE_TONE.CLOSED;
                return (
                  <span
                    className={"inline-flex items-center px-2 py-0.5 rounded-md border font-medium " + tone.pill}
                    key={stage.stage}
                  >
                    <span className={"w-1.5 h-1.5 rounded-full mr-1.5 " + tone.dot} />
                    {STAGE_LABEL[stage.stage as PipelineStage] ?? stage.stage}: {stage.count} ·{" "}
                    {formatCompact(stage.value)}
                  </span>
                );
              })}
            </div>

            <input
              className="w-64 bg-white border border-slate-200 rounded-lg px-3 py-1 text-xs text-slate-700 focus:outline-none focus:border-indigo-500 placeholder:text-slate-400"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search deals, customers, references..."
              value={search}
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden flex flex-col relative bg-slate-50/60">
          {view === "board" ? (
            <BoardView busy={busy} onOpen={openBuilder} rows={visible} />
          ) : (
            <ListView busy={busy} onOpen={openBuilder} rows={visible} />
          )}

          {builder && (
            <QuotationBuilder data={builder} onClose={() => router.push("/sales")} />
          )}
        </div>

        <StatusBar />
      </AppWindow>

      <AppDock />
      <AgentButton />
      <WorkspaceToast />
    </AppShell>
  );
}

function TabButton({
  label,
  badge,
  active,
  onClick,
}: {
  label: string;
  badge: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={
        "flex items-center space-x-1.5 pb-2.5 border-b-2 transition-colors cursor-pointer " +
        (active
          ? "font-semibold text-indigo-600 border-indigo-600"
          : "font-medium text-slate-500 hover:text-slate-800 border-transparent")
      }
      onClick={onClick}
      type="button"
    >
      <span>{label}</span>
      <span
        className={
          "font-bold px-1.5 py-0.5 rounded-full text-[10px] " +
          (active ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-600")
        }
      >
        {badge}
      </span>
    </button>
  );
}

function SwitchButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={
        "px-2.5 py-1 rounded " +
        (active
          ? "bg-white text-indigo-600 shadow-sm font-semibold"
          : "hover:text-slate-900 transition-colors")
      }
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function BoardView({
  rows,
  onOpen,
  busy,
}: {
  rows: DealRow[];
  onOpen: (id: string) => void;
  busy: boolean;
}) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto app-scroll p-6 space-y-6">
      {BOARD_STAGES.map((stage) => {
        const inStage = rows.filter((row) => row.stage === stage);
        const value = inStage.reduce((sum, row) => sum + Number(row.totalAmount), 0);
        const tone = STAGE_TONE[stage];

        return (
          <div
            className="bg-slate-100/60 rounded-xl p-3 border border-slate-200 flex flex-col"
            key={stage}
          >
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-200/80">
              <div className="flex items-center space-x-2">
                <span className={"w-2 h-2 rounded-full " + tone.dot} />
                <span className="font-bold text-xs text-slate-800">{STAGE_LABEL[stage]}</span>
                <span className={"text-[10px] px-1.5 py-0.2 rounded-full font-bold " + tone.badge}>
                  {inStage.length}
                </span>
              </div>
              <span className="text-[11px] font-medium text-slate-500">
                {inStage.length} deals · {formatCompact(value)}
              </span>
            </div>

            {inStage.length === 0 ? (
              <p className="text-[11px] text-slate-400 py-2">Nothing in this stage.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {inStage.slice(0, 6).map((row) => (
                  <button
                    className="deal-card border border-slate-200/90 rounded-xl bg-white p-3.5 shadow-2xs hover:border-indigo-200 transition-all text-left disabled:opacity-60"
                    disabled={busy}
                    key={row.id}
                    onClick={() => onOpen(row.id)}
                    type="button"
                  >
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-[11px] font-jetbrains text-slate-400">
                        {row.quoteNumber}
                      </span>
                      <span className="text-xs font-bold text-slate-900">
                        {formatCompact(row.totalAmount)}
                      </span>
                    </div>
                    <h4 className="text-xs font-semibold text-slate-900 leading-tight mb-1">
                      {row.customerName}
                    </h4>
                    <p className="text-[11px] text-slate-500 mb-2.5">
                      {row.lineCount} line{row.lineCount === 1 ? "" : "s"} · margin{" "}
                      {row.marginPercentage}%
                    </p>
                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-[10px]">
                      <span className="text-slate-600 font-medium text-xs">{row.salesRepName}</span>
                      <span className="text-slate-400">risk {row.riskScore}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {inStage.length > 6 && (
              <p className="pt-2 text-[11px] text-slate-500 font-medium">
                Showing 6 of {inStage.length}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ListView({
  rows,
  onOpen,
  busy,
}: {
  rows: DealRow[];
  onOpen: (id: string) => void;
  busy: boolean;
}) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto app-scroll p-6">
      <div className="border border-slate-200/90 rounded-xl bg-white shadow-2xs overflow-hidden">
        <table className="w-full text-left text-xs text-slate-700">
          <thead className="bg-slate-50/75 border-b border-slate-100 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">
            <tr>
              <th className="py-3 px-4">Customer</th>
              <th className="py-3 px-4">Reference</th>
              <th className="py-3 px-4 text-right">Amount</th>
              <th className="py-3 px-4 text-right">Margin</th>
              <th className="py-3 px-4">Stage</th>
              <th className="py-3 px-4">Salesperson</th>
              <th className="py-3 px-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td className="py-8 px-4 text-center text-slate-500" colSpan={7}>
                  No quotations match this search.
                </td>
              </tr>
            ) : (
              rows.slice(0, 50).map((row) => {
                const tone = STAGE_TONE[row.stage] ?? STAGE_TONE.CLOSED;
                return (
                  <tr className="hover:bg-slate-50/80 transition-colors" key={row.id}>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">{row.customerName}</div>
                      <div className="text-[11px] text-slate-500">
                        {row.lineCount} line{row.lineCount === 1 ? "" : "s"}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-jetbrains text-[11px] text-slate-500">
                      {row.quoteNumber}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-slate-900 font-jetbrains">
                      {formatRupees(row.totalAmount)}
                    </td>
                    <td className="py-3 px-4 text-right text-slate-600 font-jetbrains">
                      {row.marginPercentage}%
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={
                          "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border " +
                          tone.pill
                        }
                      >
                        <span className={"w-1.5 h-1.5 rounded-full mr-1.5 " + tone.dot} />
                        {STAGE_LABEL[row.stage]}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-700">{row.salesRepName}</td>
                    <td className="py-3 px-4 text-right">
                      <button
                        className="px-2.5 py-1 text-[11px] font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-md transition-colors disabled:opacity-60"
                        disabled={busy}
                        onClick={() => onOpen(row.id)}
                        type="button"
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {rows.length > 50 && (
        <p className="text-[11px] text-slate-500 mt-3">
          Showing the 50 most recently active of {rows.length}.
        </p>
      )}
    </div>
  );
}

function WorkspaceToast() {
  const { message, visible } = useToastState();
  return (
    <div
      className={
        "fixed bottom-20 right-6 z-50 bg-slate-900 text-white text-xs px-4 py-2.5 rounded-xl shadow-2xl transition-all duration-200 " +
        (visible ? "opacity-100" : "opacity-0 pointer-events-none translate-y-4")
      }
    >
      {message}
    </div>
  );
}
