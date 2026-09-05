"use client";

/**
 * The Pipeline board - five stages laid out in three rows rather than a
 * horizontally scrolling kanban.
 *
 * Every card has the same skeleton (reference, amount, customer, owner, time)
 * and then one of three middles: a plain subtitle in Draft, a coloured badge in
 * the middle stages, and a badge plus two detail lines in Fulfillment. DealCard
 * takes all three as optional props rather than existing in three copies.
 *
 * Only the first Draft card opens the builder. In the source screen five cards
 * all carried id="acmeDraftCard", so getElementById found exactly one - the
 * Acme card - and the other four did nothing. That is reproduced rather than
 * "fixed", because making all five open an Acme-specific builder would be worse.
 */

interface Owner {
  initial: string;
  avatar: string;
  name: string;
}

const PRIYA: Owner = { initial: "P", avatar: "bg-indigo-100 text-indigo-700", name: "Priya Sharma" };
const VIKRAM: Owner = { initial: "V", avatar: "bg-purple-100 text-purple-700", name: "Vikram Patel" };
const ANANYA: Owner = { initial: "A", avatar: "bg-teal-100 text-teal-700", name: "Ananya Rao" };
const RAHUL: Owner = { initial: "R", avatar: "bg-rose-100 text-rose-700", name: "Rahul Mehta" };

interface Deal {
  reference: string;
  amount: string;
  customer: string;
  subtitle?: string;
  badge?: { text: string; style: string; weight?: string };
  details?: { label: string; value: string; valueStyle: string }[];
  owner: Owner;
  when: string;
  /** Apex Global is outlined in rose because of its backorder. */
  border?: string;
  opensBuilder?: boolean;
}

const AMBER_BADGE = "bg-amber-50 text-amber-700 border-amber-200";
const INDIGO_BADGE = "bg-indigo-50 text-indigo-700 border-indigo-200";
const EMERALD_BADGE = "bg-emerald-50 text-emerald-700 border-emerald-200";

interface Stage {
  key: string;
  dot: string;
  title: string;
  count: string;
  countStyle: string;
  summary: string;
  deals: Deal[];
  showing: string;
  more: string;
  /** Fulfillment lays its three cards across the full width. */
  dealGrid: string;
}

const STAGES: Record<string, Stage> = {
  draft: {
    key: "draft",
    dot: "bg-blue-500",
    title: "01 Draft",
    count: "12",
    countStyle: "bg-blue-100 text-blue-700",
    summary: "12 deals · ₹42L",
    showing: "Showing 2 of 12",
    more: "+ 10 more deals →",
    dealGrid: "grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2",
    deals: [
      {
        reference: "DF-2024-1082",
        amount: "₹8.4L",
        customer: "Acme Industries",
        subtitle: "Cloud Migration & ERP",
        owner: PRIYA,
        when: "24m ago",
        opensBuilder: true,
      },
      {
        reference: "DF-2024-1059",
        amount: "₹14.0L",
        customer: "Omnicorp Labs",
        subtitle: "AI Inference Cluster",
        owner: VIKRAM,
        when: "2 days ago",
      },
    ],
  },
  approval: {
    key: "approval",
    dot: "bg-amber-500",
    title: "02 Pending Approval",
    count: "4",
    countStyle: "bg-amber-100 text-amber-700",
    summary: "4 deals · ₹18L",
    showing: "Showing 2 of 4",
    more: "+ 2 more deals →",
    dealGrid: "grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2",
    deals: [
      {
        reference: "DF-2024-1078",
        amount: "₹12.2L",
        customer: "Beta Industries",
        badge: { text: "12% Discount Exceeded", style: AMBER_BADGE },
        owner: VIKRAM,
        when: "2h ago",
      },
      {
        reference: "DF-2024-1052",
        amount: "₹32.0L",
        customer: "Helios Energy",
        badge: { text: "Margin < 15%", style: AMBER_BADGE },
        owner: PRIYA,
        when: "3 days ago",
      },
    ],
  },
  negotiation: {
    key: "negotiation",
    dot: "bg-indigo-500",
    title: "03 Under Negotiation",
    count: "3",
    countStyle: "bg-indigo-100 text-indigo-700",
    summary: "3 deals · ₹14L",
    showing: "Showing 2 of 3",
    more: "View all 3 →",
    dealGrid: "grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2",
    deals: [
      {
        reference: "DF-2024-1065",
        amount: "₹6.8L",
        customer: "Nova Systems",
        badge: { text: "Counter received", style: INDIGO_BADGE },
        owner: ANANYA,
        when: "4h ago",
      },
      {
        reference: "DF-2024-1048",
        amount: "₹7.2L",
        customer: "Quantum Dynamics",
        badge: { text: "Clause 14 Redline", style: INDIGO_BADGE },
        owner: RAHUL,
        when: "1 day ago",
      },
    ],
  },
  approved: {
    key: "approved",
    dot: "bg-emerald-500",
    title: "04 Approved",
    count: "6",
    countStyle: "bg-emerald-100 text-emerald-700",
    summary: "6 deals · ₹29L",
    showing: "Showing 2 of 6",
    more: "+ 4 more deals →",
    dealGrid: "grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2",
    deals: [
      {
        reference: "DF-2024-1064",
        amount: "₹4.1L",
        customer: "Zenith Retail",
        badge: { text: "Ready to sign", style: EMERALD_BADGE },
        owner: PRIYA,
        when: "Yesterday",
      },
      {
        reference: "DF-2024-1033",
        amount: "₹24.9L",
        customer: "Vanguard Logistics",
        badge: { text: "PO Received", style: EMERALD_BADGE },
        owner: VIKRAM,
        when: "3 days ago",
      },
    ],
  },
  fulfillment: {
    key: "fulfillment",
    dot: "bg-slate-600",
    title: "05 Fulfillment",
    count: "5",
    countStyle: "bg-slate-200 text-slate-700",
    summary: "5 deals · ₹21L",
    showing: "Showing 3 of 5",
    more: "+ 2 more deals →",
    dealGrid: "grid grid-cols-1 md:grid-cols-3 gap-3 mb-2",
    deals: [
      {
        reference: "DF-2024-1063",
        amount: "₹19.5L",
        customer: "Apex Global",
        badge: { text: "Backorder Alert", style: "bg-rose-50 text-rose-700 border-rose-200", weight: "font-semibold" },
        details: [
          { label: "Warehouse", value: "Main + East Hub", valueStyle: "font-medium text-slate-700" },
          { label: "Backorder", value: "5 units server racks", valueStyle: "text-rose-600 font-medium" },
        ],
        owner: RAHUL,
        when: "1 day ago",
        border: "border-rose-200/80",
      },
      {
        reference: "DF-2024-1019",
        amount: "₹1.5L",
        customer: "Horizon Health Tech",
        badge: { text: "Allocation Ready", style: EMERALD_BADGE, weight: "font-semibold" },
        details: [
          { label: "Warehouse", value: "North Depot", valueStyle: "font-medium text-slate-700" },
          { label: "Stock", value: "100% In Stock", valueStyle: "text-emerald-700 font-medium" },
        ],
        owner: ANANYA,
        when: "2 days ago",
      },
      {
        reference: "DF-2024-1012",
        amount: "₹8.2L",
        customer: "CyberShield Corp",
        badge: { text: "Dispatch Pending", style: "bg-blue-50 text-blue-700 border-blue-200", weight: "font-semibold" },
        details: [
          { label: "Warehouse", value: "West Facility", valueStyle: "font-medium text-slate-700" },
          { label: "Status", value: "Awaiting Carrier", valueStyle: "text-blue-700 font-medium" },
        ],
        owner: PRIYA,
        when: "4 days ago",
      },
    ],
  },
};

const STAGE_PILLS = [
  { label: "Draft: 12 deals · ₹42L", style: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-500" },
  { label: "Approval: 4 deals · ₹18L", style: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" },
  { label: "Negotiation: 3 deals · ₹14L", style: "bg-indigo-50 text-indigo-700 border-indigo-200", dot: "bg-indigo-500" },
  { label: "Approved: 6 deals · ₹29L", style: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  { label: "Fulfillment: 5 deals · ₹21L", style: "bg-slate-100 text-slate-700 border-slate-200", dot: "bg-slate-500" },
];

const DEAL_SEGMENTS = ["All Deals (30)", "My Deals (14)", "Needs Action (4)"];

export function PipelineView({ onOpenBuilder }: { onOpenBuilder: () => void }) {
  return (
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
      {/* Pipeline Summary Stats Bar & Compact Stage Pills */}
      <div className="px-6 py-2 bg-white border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
        <div className="flex items-center space-x-3">
          <span className="text-xs font-semibold text-slate-800">
            30 active deals <span className="text-slate-300 font-normal">·</span>{" "}
            <strong className="text-indigo-700 font-bold">₹1.24 Cr</strong> active pipeline
          </span>
        </div>
        <div className="flex items-center flex-wrap gap-2 text-[11px]">
          {STAGE_PILLS.map((pill) => (
            <span
              key={pill.label}
              className={"inline-flex items-center px-2 py-0.5 rounded-md border font-medium " + pill.style}
            >
              <span className={"w-1.5 h-1.5 rounded-full mr-1.5 " + pill.dot} />
              {pill.label}
            </span>
          ))}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="px-6 py-2 bg-white/70 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
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
              className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-3 py-1 text-xs text-slate-700 focus:bg-white focus:outline-none focus:border-indigo-500 placeholder:text-slate-400"
              placeholder="Search deals, customers, references..."
              type="text"
            />
          </div>
          <button
            className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-slate-600 font-medium hover:bg-slate-50 flex items-center space-x-1"
            type="button"
          >
            <span>Filter ▾</span>
          </button>
        </div>
        <div className="flex items-center bg-slate-100 p-0.5 rounded-lg text-[11px] font-medium text-slate-600">
          {DEAL_SEGMENTS.map((segment, index) => (
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

      {/* Multi-Row Stage Layout (No Horizontal Kanban Scroll) */}
      <div className="flex-1 min-h-0 overflow-y-auto app-scroll p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <StageColumn stage={STAGES.draft} onOpenBuilder={onOpenBuilder} />
          <StageColumn stage={STAGES.approval} onOpenBuilder={onOpenBuilder} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <StageColumn stage={STAGES.negotiation} onOpenBuilder={onOpenBuilder} />
          <StageColumn stage={STAGES.approved} onOpenBuilder={onOpenBuilder} />
        </div>
        <StageColumn stage={STAGES.fulfillment} onOpenBuilder={onOpenBuilder} />
      </div>
    </div>
  );
}

function StageColumn({ stage, onOpenBuilder }: { stage: Stage; onOpenBuilder: () => void }) {
  return (
    <div className="bg-slate-100/60 rounded-xl p-3 border border-slate-200 flex flex-col">
      <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-200/80">
        <div className="flex items-center space-x-2">
          <span className={"w-2 h-2 rounded-full " + stage.dot} />
          <span className="font-bold text-xs text-slate-800">{stage.title}</span>
          <span className={"text-[10px] px-1.5 py-0.2 rounded-full font-bold " + stage.countStyle}>
            {stage.count}
          </span>
        </div>
        <span className="text-[11px] font-medium text-slate-500">{stage.summary}</span>
      </div>

      <div className={stage.dealGrid}>
        {stage.deals.map((deal) => (
          <DealCard key={deal.reference} deal={deal} onOpenBuilder={onOpenBuilder} />
        ))}
      </div>

      <div className="pt-1 flex items-center justify-between text-[11px]">
        <span className="text-slate-500 font-medium">{stage.showing}</span>
        <a className="text-indigo-600 hover:text-indigo-700 font-semibold cursor-pointer" href="#">
          {stage.more}
        </a>
      </div>
    </div>
  );
}

function DealCard({ deal, onOpenBuilder }: { deal: Deal; onOpenBuilder: () => void }) {
  return (
    <div
      className={
        "deal-card border rounded-xl bg-white p-3.5 shadow-2xs hover:border-indigo-200 transition-all cursor-grab active:cursor-grabbing " +
        (deal.border ?? "border-slate-200/90")
      }
      onClick={deal.opensBuilder ? onOpenBuilder : undefined}
    >
      <div className="flex justify-between items-start mb-1">
        <span className="text-[11px] font-jetbrains text-slate-400">{deal.reference}</span>
        <span className="text-xs font-bold text-slate-900">{deal.amount}</span>
      </div>
      <h4 className="text-xs font-semibold text-slate-900 leading-tight mb-1">{deal.customer}</h4>

      {deal.subtitle && <p className="text-[11px] text-slate-500 mb-2.5">{deal.subtitle}</p>}

      {deal.badge && (
        <div className="mb-2">
          <span
            className={
              "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border " +
              (deal.badge.weight ?? "font-medium") +
              " " +
              deal.badge.style
            }
          >
            {deal.badge.text}
          </span>
        </div>
      )}

      {deal.details && (
        <div className="text-[11px] space-y-0.5 text-slate-500 mb-2">
          {deal.details.map((detail) => (
            <p key={detail.label}>
              {detail.label}: <span className={detail.valueStyle}>{detail.value}</span>
            </p>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-[10px]">
        <div className="flex items-center space-x-1.5">
          <div
            className={
              "w-4 h-4 rounded-full font-bold flex items-center justify-center text-[9px] " +
              deal.owner.avatar
            }
          >
            {deal.owner.initial}
          </div>
          <span className="text-slate-600 font-medium text-xs">{deal.owner.name}</span>
        </div>
        <span className="text-slate-400">{deal.when}</span>
      </div>
    </div>
  );
}
