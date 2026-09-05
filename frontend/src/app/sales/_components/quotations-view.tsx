"use client";

/**
 * The Quotations table view - the list half of the workspace.
 *
 * Seven rows, each with its own status pill and salesperson chip. The "Resume"
 * buttons open the quotation builder: in the source screen that was wired by
 * scanning every <button> on the page for the literal text "Resume", which is
 * why the two Resume rows behave differently from Review/Open/View.
 */

interface QuotationRow {
  customer: string;
  detail: string;
  reference: string;
  amount: string;
  status: string;
  statusPill: string;
  statusDot: string;
  ownerInitial: string;
  ownerAvatar: string;
  owner: string;
  activity: string;
  action: "Resume" | "Review" | "Open" | "View";
  actionStyle: string;
}

const ACTION_STYLES = {
  Resume: "text-indigo-600 bg-indigo-50 hover:bg-indigo-100",
  Review: "text-amber-700 bg-amber-50 hover:bg-amber-100",
  Open: "text-indigo-600 bg-indigo-50 hover:bg-indigo-100",
  View: "text-slate-700 bg-slate-100 hover:bg-slate-200",
} as const;

const ROWS: QuotationRow[] = [
  {
    customer: "Acme Industries",
    detail: "Cloud Migration & ERP Integration",
    reference: "DF-2024-1082",
    amount: "₹8.40 L",
    status: "Draft",
    statusPill: "bg-blue-50 text-blue-700 border-blue-200",
    statusDot: "bg-blue-500",
    ownerInitial: "P",
    ownerAvatar: "bg-indigo-100 text-indigo-700",
    owner: "Priya Sharma",
    activity: "24m ago",
    action: "Resume",
    actionStyle: ACTION_STYLES.Resume,
  },
  {
    customer: "Beta Industries",
    detail: "Supply Chain Logistics API",
    reference: "DF-2024-1078",
    amount: "₹12.20 L",
    status: "Pending Approval",
    statusPill: "bg-amber-50 text-amber-700 border-amber-200",
    statusDot: "bg-amber-500",
    ownerInitial: "V",
    ownerAvatar: "bg-purple-100 text-purple-700",
    owner: "Vikram Patel",
    activity: "2h ago",
    action: "Review",
    actionStyle: ACTION_STYLES.Review,
  },
  {
    customer: "Nova Systems",
    detail: "Managed Support Contract",
    reference: "DF-2024-1065",
    amount: "₹6.80 L",
    status: "Under Negotiation",
    statusPill: "bg-indigo-50 text-indigo-700 border-indigo-200",
    statusDot: "bg-indigo-500",
    ownerInitial: "A",
    ownerAvatar: "bg-teal-100 text-teal-700",
    owner: "Ananya Rao",
    activity: "4h ago",
    action: "Open",
    actionStyle: ACTION_STYLES.Open,
  },
  {
    customer: "Zenith Retail",
    detail: "Omnichannel Hardware & POS",
    reference: "DF-2024-1064",
    amount: "₹4.10 L",
    status: "Approved",
    statusPill: "bg-emerald-50 text-emerald-700 border-emerald-200",
    statusDot: "bg-emerald-500",
    ownerInitial: "P",
    ownerAvatar: "bg-indigo-100 text-indigo-700",
    owner: "Priya Sharma",
    activity: "Yesterday",
    action: "View",
    actionStyle: ACTION_STYLES.View,
  },
  {
    customer: "Apex Global",
    detail: "Regional Cloud Infrastructure",
    reference: "DF-2024-1063",
    amount: "₹19.50 L",
    status: "Backorder",
    statusPill: "bg-rose-50 text-rose-700 border-rose-200",
    statusDot: "bg-rose-500",
    ownerInitial: "R",
    ownerAvatar: "bg-rose-100 text-rose-700",
    owner: "Rahul Mehta",
    activity: "1 day ago",
    action: "View",
    actionStyle: ACTION_STYLES.View,
  },
  {
    customer: "Omnicorp Labs",
    detail: "AI Inference Cluster",
    reference: "DF-2024-1059",
    amount: "₹14.00 L",
    status: "Draft",
    statusPill: "bg-blue-50 text-blue-700 border-blue-200",
    statusDot: "bg-blue-500",
    ownerInitial: "V",
    ownerAvatar: "bg-purple-100 text-purple-700",
    owner: "Vikram Patel",
    activity: "2 days ago",
    action: "Resume",
    actionStyle: ACTION_STYLES.Resume,
  },
  {
    customer: "Helios Energy",
    detail: "Smart Grid Substation CPQ",
    reference: "DF-2024-1052",
    amount: "₹32.00 L",
    status: "Pending Approval",
    statusPill: "bg-amber-50 text-amber-700 border-amber-200",
    statusDot: "bg-amber-500",
    ownerInitial: "P",
    ownerAvatar: "bg-indigo-100 text-indigo-700",
    owner: "Priya Sharma",
    activity: "3 days ago",
    action: "Review",
    actionStyle: ACTION_STYLES.Review,
  },
];

const SEGMENTS = ["All (12)", "Action Needed (4)", "Draft (3)"];

export function QuotationsView({ onResume }: { onResume: () => void }) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto app-scroll flex flex-col">
      {/* Quotations Filter Bar */}
      <div className="px-6 py-2.5 bg-white border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
        <div className="flex items-center space-x-2 flex-1 min-w-[280px]">
          <div className="relative w-72">
            <svg
              className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
            </svg>
            <input
              className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-700 focus:bg-white focus:outline-none focus:border-indigo-500 placeholder:text-slate-400"
              placeholder="Search quotations, customers, references..."
              type="text"
            />
          </div>
          <button className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-600 font-medium hover:bg-slate-50 flex items-center space-x-1" type="button">
            <span>Status: All ▾</span>
          </button>
          <button className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-600 font-medium hover:bg-slate-50 flex items-center space-x-1" type="button">
            <span>Salesperson: All ▾</span>
          </button>
          <button className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-600 font-medium hover:bg-slate-50 flex items-center space-x-1" type="button">
            <span>Date: Last 30 Days ▾</span>
          </button>
        </div>
        <div className="flex items-center bg-slate-100 p-0.5 rounded-lg text-[11px] font-medium text-slate-600">
          {SEGMENTS.map((segment, index) => (
            <button
              key={segment}
              className={
                index === 0
                  ? "px-2.5 py-1 rounded bg-white text-indigo-600 shadow-sm font-semibold"
                  : "px-2.5 py-1 rounded hover:text-slate-900 transition-colors"
              }
              type="button"
            >
              {segment}
            </button>
          ))}
        </div>
      </div>

      {/* Full Enterprise Quotations Data Table */}
      <div className="flex-1 min-h-0 overflow-x-auto app-scroll p-6">
        <div className="border border-slate-200/90 rounded-xl bg-white shadow-2xs overflow-hidden">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-50/75 border-b border-slate-100 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">DEAL / CUSTOMER</th>
                <th className="py-3 px-4">REFERENCE</th>
                <th className="py-3 px-4">AMOUNT</th>
                <th className="py-3 px-4">STATUS</th>
                <th className="py-3 px-4">SALESPERSON</th>
                <th className="py-3 px-4">LAST ACTIVITY</th>
                <th className="py-3 px-4 text-right">ACTION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ROWS.map((row) => (
                <tr key={row.reference} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-900">{row.customer}</div>
                    <div className="text-[11px] text-slate-500">{row.detail}</div>
                  </td>
                  <td className="py-3 px-4 font-jetbrains text-[11px] text-slate-500">{row.reference}</td>
                  <td className="py-3 px-4 font-bold text-slate-900 font-jetbrains">{row.amount}</td>
                  <td className="py-3 px-4">
                    <span
                      className={
                        "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border " +
                        row.statusPill
                      }
                    >
                      <span className={"w-1.5 h-1.5 rounded-full mr-1.5 " + row.statusDot} />
                      {row.status}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center space-x-1.5">
                      <div
                        className={
                          "w-5 h-5 rounded-full font-bold flex items-center justify-center text-[10px] " +
                          row.ownerAvatar
                        }
                      >
                        {row.ownerInitial}
                      </div>
                      <span className="font-medium text-slate-700">{row.owner}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-slate-400 text-[11px]">{row.activity}</td>
                  <td className="py-3 px-4 text-right">
                    <button
                      className={
                        "px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors " +
                        row.actionStyle
                      }
                      onClick={row.action === "Resume" ? onResume : undefined}
                      type="button"
                    >
                      {row.action}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quotations Table Footer */}
      <div className="px-6 py-3 bg-white border-t border-slate-200/80 flex items-center justify-between text-xs text-slate-500 shrink-0">
        <span>
          Showing <span className="font-semibold text-slate-700">7</span> of{" "}
          <span className="font-semibold text-slate-700">12</span> active quotations • Total Pipeline
          Value: <strong className="text-indigo-700 font-bold">₹1.24 Cr</strong>
        </span>
        <div className="flex items-center space-x-2">
          <button
            className="px-2.5 py-1 border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-50 text-slate-600 font-medium"
            disabled
            type="button"
          >
            Previous
          </button>
          <span className="text-slate-600 font-medium px-1">Page 1 of 2</span>
          <button
            className="px-2.5 py-1 border border-slate-200 rounded-md hover:bg-slate-50 text-slate-700 font-medium"
            type="button"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
