"use client";

import { useToast } from "@/components/toast";
import { DEAL_FILTER_LABELS, type DealFilter } from "./deal-filter";

/**
 * Recent Deals: a table on desktop, a card list below the sm breakpoint.
 *
 * Both views show the same five deals, so they are rendered from one DEALS
 * array. The mobile cards abbreviate a few strings ("Cloud Migration" rather
 * than "Cloud Migration & ERP") and drop the border on the first status pill;
 * those differences are in the data rather than in a second copy of the markup.
 *
 * The filter matches the source exactly: a deal shows when the filter is "all"
 * or the filter equals its own category. Zenith Retail is categorised "all", so
 * - as in the original - it disappears under both of the other two filters.
 */

interface Deal {
  name: string;
  initials: string;
  summary: string;
  /** The shorter line the mobile card shows after the reference. */
  mobileSummary: string;
  reference: string;
  amount: string;
  status: string;
  activity: string;
  action: string;
  category: DealFilter;
  avatar: string;
  badge: string;
  /** The mobile pill drops the border on Draft only. */
  mobileBadge: string;
  actionStyle: string;
  mobileActionStyle: string;
  rowToast: string;
  mobileToast: string;
  actionToast: string;
}

const DEALS: Deal[] = [
  {
    name: "Acme Industries",
    initials: "AI",
    summary: "Cloud Migration & ERP",
    mobileSummary: "Cloud Migration",
    reference: "DF-2024-1082",
    amount: "₹8.4L",
    status: "Draft",
    activity: "24m ago",
    action: "Resume",
    category: "draft",
    avatar: "bg-indigo-50 text-indigo-700 border-indigo-100",
    badge: "bg-slate-100 text-slate-700 border border-slate-200",
    mobileBadge: "bg-slate-100 text-slate-700",
    actionStyle: "text-indigo-600 hover:text-indigo-800",
    mobileActionStyle: "text-indigo-600",
    rowToast: "Opening Acme Industries deal details",
    mobileToast: "Opening Acme Industries",
    actionToast: "Resuming draft DF-2024-1082",
  },
  {
    name: "Beta Industries",
    initials: "BI",
    summary: "Supply Chain Logistics API",
    mobileSummary: "Supply Chain API",
    reference: "DF-2024-1078",
    amount: "₹12.2L",
    status: "Pending Approval",
    activity: "2h ago",
    action: "Review",
    category: "action",
    avatar: "bg-amber-50 text-amber-700 border-amber-100",
    badge: "bg-amber-50 text-amber-700 border border-amber-200",
    mobileBadge: "bg-amber-50 text-amber-700 border border-amber-200",
    actionStyle: "text-indigo-600 hover:text-indigo-800",
    mobileActionStyle: "text-indigo-600",
    rowToast: "Opening Beta Industries approval",
    mobileToast: "Opening Beta Industries",
    actionToast: "Reviewing Beta Industries approval",
  },
  {
    name: "Nova Systems",
    initials: "NS",
    summary: "Managed Support Contract",
    mobileSummary: "Managed Support",
    reference: "DF-2024-1065",
    amount: "₹6.8L",
    status: "Under Negotiation",
    activity: "4h ago",
    action: "Open",
    category: "action",
    avatar: "bg-indigo-50 text-indigo-700 border-indigo-100",
    badge: "bg-indigo-50 text-indigo-700 border border-indigo-200",
    mobileBadge: "bg-indigo-50 text-indigo-700 border border-indigo-200",
    actionStyle: "text-indigo-600 hover:text-indigo-800",
    mobileActionStyle: "text-indigo-600",
    rowToast: "Opening Nova Systems negotiation terms",
    mobileToast: "Opening Nova Systems",
    actionToast: "Opening Nova Systems deal terms",
  },
  {
    name: "Zenith Retail",
    initials: "ZR",
    summary: "Omnichannel Hardware & POS",
    mobileSummary: "POS Hardware",
    reference: "DF-2024-1064",
    amount: "₹4.1L",
    status: "Approved",
    activity: "Yesterday",
    action: "View",
    category: "all",
    avatar: "bg-emerald-50 text-emerald-700 border-emerald-100",
    badge: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    mobileBadge: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    actionStyle: "text-slate-600 hover:text-slate-900",
    mobileActionStyle: "text-slate-600",
    rowToast: "Opening Zenith Retail agreement",
    mobileToast: "Opening Zenith Retail",
    actionToast: "Viewing Zenith Retail contract",
  },
  {
    name: "Apex Global",
    initials: "AG",
    summary: "Regional Cloud Infrastructure",
    mobileSummary: "Cloud Infra",
    reference: "DF-2024-1064",
    amount: "₹19.5L",
    status: "Backorder",
    activity: "1 day ago",
    action: "View",
    category: "action",
    avatar: "bg-rose-50 text-rose-700 border-rose-100",
    badge: "bg-rose-50 text-rose-700 border border-rose-200",
    mobileBadge: "bg-rose-50 text-rose-700 border border-rose-200",
    actionStyle: "text-slate-600 hover:text-slate-900",
    mobileActionStyle: "text-slate-600",
    rowToast: "Opening Apex Global order",
    mobileToast: "Opening Apex Global",
    actionToast: "Viewing Apex Global fulfillment status",
  },
];

const TABS: { key: DealFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "action", label: "Action Needed" },
  { key: "draft", label: "Draft" },
];

export function RecentDeals({
  filter,
  onFilter,
}: {
  filter: DealFilter;
  onFilter: (filter: DealFilter) => void;
}) {
  const showToast = useToast();
  const visible = DEALS.filter((deal) => filter === "all" || deal.category === filter);

  return (
    <div className="lg:col-span-8 bg-white border border-slate-200/90 rounded-xl shadow-2xs flex flex-col justify-between overflow-hidden">
      <div>
        {/* Header & Interactive Filter Tabs */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <h2 className="font-display text-sm font-bold text-slate-900">Recent Deals</h2>
            <span className="text-xs text-slate-400 font-normal">Active operational workflow</span>
          </div>
          <div className="inline-flex rounded-lg p-0.5 bg-slate-100 border border-slate-200/80 text-xs font-medium self-start sm:self-auto">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                className={
                  "filter-tab px-3 py-1 rounded-md transition-all " +
                  (filter === tab.key
                    ? "text-slate-900 bg-white shadow-2xs font-semibold"
                    : "text-slate-600 hover:text-slate-900")
                }
                onClick={() => onFilter(tab.key)}
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Desktop Table View */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50/75 border-b border-slate-100 text-slate-600 text-[10px] font-semibold uppercase tracking-wider">
                <th className="py-3 px-5 font-semibold">Deal &amp; Client</th>
                <th className="py-3 px-3 font-semibold">Ref</th>
                <th className="py-3 px-3 text-right font-semibold">Amount</th>
                <th className="py-3 px-3 font-semibold">Status</th>
                <th className="py-3 px-3 font-semibold">Activity</th>
                <th className="py-3 px-5 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {visible.map((deal) => (
                <tr
                  key={deal.name}
                  className="deal-row hover:bg-slate-50/70 transition-colors cursor-pointer"
                  onClick={() => showToast(deal.rowToast)}
                >
                  <td className="py-3.5 px-5">
                    <div className="flex items-center gap-3">
                      <div
                        className={
                          "w-8 h-8 rounded-lg font-bold font-display text-xs flex items-center justify-center shrink-0 border " +
                          deal.avatar
                        }
                      >
                        {deal.initials}
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900 leading-snug">{deal.name}</div>
                        <div className="text-xs text-slate-500">{deal.summary}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3.5 px-3 font-jetbrains text-xs text-slate-500">{deal.reference}</td>
                  <td className="py-3.5 px-3 font-jetbrains text-right font-bold text-slate-900">
                    {deal.amount}
                  </td>
                  <td className="py-3.5 px-3">
                    <span
                      className={
                        "inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium " + deal.badge
                      }
                    >
                      {deal.status}
                    </span>
                  </td>
                  <td className="py-3.5 px-3 text-xs text-slate-500">{deal.activity}</td>
                  <td className="py-3.5 px-5 text-right">
                    <button
                      className={"text-xs font-semibold transition-colors " + deal.actionStyle}
                      onClick={(event) => {
                        event.stopPropagation();
                        showToast(deal.actionToast);
                      }}
                      type="button"
                    >
                      {deal.action}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile Cards View */}
        <div className="sm:hidden divide-y divide-slate-100">
          {visible.map((deal) => (
            <div
              key={deal.name}
              className="deal-row p-4 space-y-2 cursor-pointer hover:bg-slate-50"
              onClick={() => showToast(deal.mobileToast)}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div
                    className={
                      "w-7 h-7 rounded font-bold font-display text-xs flex items-center justify-center " +
                      deal.avatar
                    }
                  >
                    {deal.initials}
                  </div>
                  <div>
                    <span className="font-semibold text-slate-900 text-sm">{deal.name}</span>
                    <p className="text-xs text-slate-500">
                      {deal.reference} • {deal.mobileSummary}
                    </p>
                  </div>
                </div>
                <span className="font-jetbrains font-bold text-sm text-slate-900">{deal.amount}</span>
              </div>
              <div className="flex items-center justify-between pt-1">
                <span
                  className={
                    "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium " + deal.mobileBadge
                  }
                >
                  {deal.status}
                </span>
                <button className={"text-xs font-semibold " + deal.mobileActionStyle} type="button">
                  {deal.action} →
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Table Footer */}
      <div className="p-4 sm:px-5 border-t border-slate-100 flex items-center justify-between text-xs bg-slate-50/40">
        <span className="text-slate-500 font-jetbrains">
          Showing {visible.length} of 12 active deals
        </span>
        <a
          className="font-semibold text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1 transition-colors"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            showToast("Loading full pipeline in Sales Workspace");
          }}
        >
          <span>View all deals</span>
          <span className="text-[13px]">→</span>
        </a>
      </div>
    </div>
  );
}

/** So the page can echo the original toast wording when a filter changes. */
export function dealFilterToast(filter: DealFilter): string {
  return "Filtered recent deals: " + DEAL_FILTER_LABELS[filter];
}
