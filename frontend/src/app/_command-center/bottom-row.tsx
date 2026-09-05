"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { ROUTES } from "@/lib/navigation";

/**
 * The three cards along the bottom of the command centre: Sales Performance,
 * Upcoming & Deadlines, and Team Activity.
 *
 * They share a file because they share a row and none is large; each is its own
 * component below.
 */

export function BottomRow() {
  return (
    <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <SalesPerformance />
      <UpcomingDeadlines />
      <TeamActivity />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Column A - Sales Performance
// ---------------------------------------------------------------------------

const RANGES = ["7D", "30D", "90D"] as const;

/** The four bars of the velocity chart, with the tooltip each one toasts. */
const VELOCITY = [
  { week: "W1", height: "48%", bar: "bg-indigo-100 hover:bg-indigo-200", toast: "Week 1: 5 quotations • ₹8.4L" },
  { week: "W2", height: "64%", bar: "bg-indigo-200 hover:bg-indigo-300", toast: "Week 2: 7 quotations • ₹12.6L" },
  { week: "W3", height: "88%", bar: "bg-indigo-400 hover:bg-indigo-500", toast: "Week 3: 11 quotations • ₹19.2L" },
  {
    week: "W4",
    height: "82%",
    bar: "bg-indigo-600 hover:bg-indigo-700",
    toast: "Week 4 (Current): 11 quotations • ₹18.0L",
  },
];

function SalesPerformance() {
  const showToast = useToast();
  const router = useRouter();
  // The source screen highlighted 30D and never moved it, because switching only
  // raised a toast. The highlight follows the click now; the data is unchanged.
  const [range, setRange] = useState<(typeof RANGES)[number]>("30D");

  return (
    <div className="lg:col-span-5 bg-white border border-slate-200/90 rounded-xl shadow-2xs flex flex-col justify-between overflow-hidden">
      <div>
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="font-display text-sm font-bold text-slate-900">Sales Performance</h2>
            <p className="text-xs text-slate-500 mt-0.5">Operational pipeline conversion</p>
          </div>
          <div className="inline-flex rounded-lg p-0.5 bg-slate-100 border border-slate-200/80 text-xs font-medium">
            {RANGES.map((option) => (
              <button
                key={option}
                className={
                  "px-2.5 py-0.5 rounded-md transition-colors " +
                  (range === option
                    ? "text-slate-900 bg-white shadow-2xs font-semibold"
                    : "text-slate-600 hover:text-slate-900")
                }
                onClick={() => {
                  setRange(option);
                  showToast("Switched to " + rangeLabel(option) + " view");
                }}
                type="button"
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <div className="p-4 sm:p-5">
          {/* Metric conversion summary strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 bg-slate-50/70 rounded-lg border border-slate-100 mb-4">
            <div>
              <span className="text-[11px] font-medium text-slate-500 block">Created</span>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="font-jetbrains font-bold text-base text-slate-900">34</span>
                <span className="text-[10px] font-semibold text-emerald-600">+12%</span>
              </div>
            </div>
            <div>
              <span className="text-[11px] font-medium text-slate-500 block">Won</span>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="font-jetbrains font-bold text-base text-slate-900">22</span>
                <span className="text-[10px] text-slate-400 font-jetbrains">64.7%</span>
              </div>
            </div>
            <div>
              <span className="text-[11px] font-medium text-slate-500 block">Lost</span>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="font-jetbrains font-bold text-base text-slate-900">4</span>
                <span className="text-[10px] text-rose-600 font-jetbrains">11.7%</span>
              </div>
            </div>
            <div>
              <span className="text-[11px] font-medium text-slate-500 block">Win Rate</span>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="font-jetbrains font-bold text-base text-indigo-700">68.2%</span>
              </div>
            </div>
          </div>

          {/* Weekly Quotation Velocity */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="font-semibold uppercase tracking-wider text-[11px] text-slate-700">
                Weekly Quotation Velocity
              </span>
              <span className="font-jetbrains text-[11px] text-slate-400">Avg ₹14.8L / wk</span>
            </div>
            <div className="h-28 w-full flex items-end justify-between gap-3 pt-4 px-3 pb-1.5 bg-slate-50/40 border border-slate-100 rounded-lg">
              {VELOCITY.map((point) => (
                <div
                  key={point.week}
                  className="flex-1 flex flex-col items-center gap-1.5 group cursor-pointer"
                  onClick={() => showToast(point.toast)}
                >
                  <div
                    className={"w-full rounded transition-all " + point.bar}
                    style={{ height: point.height }}
                  />
                  <span
                    className={
                      "text-[10px] font-jetbrains " +
                      (point.week === "W4" ? "font-bold text-indigo-600" : "text-slate-400")
                    }
                  >
                    {point.week}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="p-3.5 sm:px-5 border-t border-slate-100 flex items-center justify-between text-xs bg-slate-50/40">
        <span className="text-slate-500">
          Target attainment: <strong className="text-slate-900 font-semibold">108%</strong> this month
        </span>
        <a
          className="font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
          href={ROUTES.dealHealth}
          onClick={(event) => {
            event.preventDefault();
            showToast("Opening Deal Health Analytics");
            router.push(ROUTES.dealHealth);
          }}
        >
          Detailed Analytics →
        </a>
      </div>
    </div>
  );
}

function rangeLabel(range: (typeof RANGES)[number]): string {
  return range === "7D" ? "7 Days" : range === "30D" ? "30 Days" : "90 Days";
}

// ---------------------------------------------------------------------------
// Column B - Upcoming & Deadlines
// ---------------------------------------------------------------------------

interface Deadline {
  time: string;
  title: string;
  tag: string;
  tagStyle: string;
  action: string;
  toast: string;
}

const TODAY: Deadline[] = [
  {
    time: "09:30",
    title: "Acme quotation expires",
    tag: "Expiry",
    tagStyle: "bg-rose-50 text-rose-700 border border-rose-200",
    action: "Extend",
    toast: "Extending Acme quotation expiry by 7 days",
  },
  {
    time: "11:00",
    title: "Beta approval review",
    tag: "Approval",
    tagStyle: "bg-amber-50 text-amber-700 border border-amber-200",
    action: "Review",
    toast: "Opening Beta approval review sheet",
  },
  {
    time: "14:00",
    title: "Nova negotiation sync",
    tag: "Follow-up",
    tagStyle: "bg-indigo-50 text-indigo-700 border border-indigo-200",
    action: "Call",
    toast: "Initiating call/sync with Nova Systems",
  },
];

const TOMORROW: Deadline[] = [
  {
    time: "10:00",
    title: "Zenith quote validity lapse",
    tag: "Expiry",
    tagStyle: "bg-slate-100 text-slate-600 border border-slate-200",
    action: "View",
    toast: "Viewing Zenith quotation details",
  },
  {
    time: "15:30",
    title: "Apex backorder triage",
    tag: "Logistics",
    tagStyle: "bg-rose-50 text-rose-700 border border-rose-200",
    action: "Check",
    toast: "Checking Depot inventory status",
  },
];

function UpcomingDeadlines() {
  const showToast = useToast();

  return (
    <div className="lg:col-span-4 bg-white border border-slate-200/90 rounded-xl shadow-2xs flex flex-col justify-between overflow-hidden">
      <div>
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="font-display text-sm font-bold text-slate-900">
              Upcoming &amp; Deadlines
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Required sales actions</p>
          </div>
          <button
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1"
            onClick={() => showToast("Opening sales calendar schedule")}
            type="button"
          >
            <span className="material-symbols-outlined text-[15px]">calendar_month</span>
            Calendar
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          <DeadlineGroup label="Today" labelStyle="text-rose-600" timeStyle="text-slate-500" items={TODAY} />
          <DeadlineGroup
            label="Tomorrow"
            labelStyle="text-slate-400"
            timeStyle="text-slate-400"
            items={TOMORROW}
          />
        </div>
      </div>

      <div className="p-3.5 sm:px-5 border-t border-slate-100 flex items-center justify-end text-xs bg-slate-50/40">
        <a
          className="font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            showToast("Navigating to task manager");
          }}
        >
          View all tasks →
        </a>
      </div>
    </div>
  );
}

function DeadlineGroup({
  label,
  labelStyle,
  timeStyle,
  items,
}: {
  label: string;
  labelStyle: string;
  /** Today's times are a shade darker than tomorrow's. */
  timeStyle: string;
  items: Deadline[];
}) {
  const showToast = useToast();

  return (
    <div>
      <div className="flex items-center gap-2 mb-2.5">
        <span
          className={"text-[10px] font-bold uppercase tracking-wider font-jetbrains " + labelStyle}
        >
          {label}
        </span>
        <div className="flex-1 h-px bg-slate-100" />
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={item.title}
            className="flex items-center justify-between gap-2 p-2.5 hover:bg-slate-50 rounded-lg border border-slate-100 text-xs transition-colors"
          >
            <div className="flex items-start gap-2.5 min-w-0">
              <span
                className={"font-jetbrains font-medium text-[11px] shrink-0 mt-0.5 " + timeStyle}
              >
                {item.time}
              </span>
              <div className="truncate">
                <p className="font-medium text-slate-900 truncate">{item.title}</p>
                <span
                  className={
                    "inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-medium mt-0.5 " +
                    item.tagStyle
                  }
                >
                  {item.tag}
                </span>
              </div>
            </div>
            <button
              className="shrink-0 px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-50 shadow-2xs"
              onClick={() => showToast(item.toast)}
              type="button"
            >
              {item.action}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Column C - Team Activity
// ---------------------------------------------------------------------------

interface Activity {
  initials: string;
  avatar: string;
  actor: string;
  did: string;
  subject: string;
  when: string;
}

const ACTIVITY: Activity[] = [
  {
    initials: "PS",
    avatar: "bg-indigo-100 text-indigo-700",
    actor: "Priya Sharma",
    did: "updated commercial terms for",
    subject: "Acme Industries",
    when: "14m ago",
  },
  {
    initials: "VP",
    avatar: "bg-amber-100 text-amber-700",
    actor: "Vikram Patel",
    did: "approved 12% discount exception for",
    subject: "Beta Industries",
    when: "1h ago",
  },
  {
    initials: "AR",
    avatar: "bg-emerald-100 text-emerald-700",
    actor: "Ananya Rao",
    did: "received revised counter-proposal for",
    subject: "Nova Systems",
    when: "3h ago",
  },
  {
    initials: "RM",
    avatar: "bg-slate-100 text-slate-700",
    actor: "Rahul Mehta",
    did: "updated allocation for",
    subject: "Apex Global",
    when: "5h ago",
  },
];

function TeamActivity() {
  const showToast = useToast();

  return (
    <div className="lg:col-span-3 bg-white border border-slate-200/90 rounded-xl shadow-2xs flex flex-col justify-between overflow-hidden">
      <div>
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="font-display text-sm font-bold text-slate-900">Team Activity</h2>
            <p className="text-xs text-slate-500 mt-0.5">Audit log</p>
          </div>
          <button
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
            onClick={() => showToast("Opening full operations audit trail")}
            type="button"
          >
            Audit Log
          </button>
        </div>

        <div className="p-4 sm:p-5 divide-y divide-slate-100 text-xs">
          {ACTIVITY.map((entry) => (
            <div key={entry.initials} className="py-3 flex items-start gap-2.5 first:pt-0 last:pb-0">
              <span
                className={
                  "w-6 h-6 rounded-full font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5 " +
                  entry.avatar
                }
              >
                {entry.initials}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-slate-800 leading-snug">
                  <span className="font-semibold text-slate-900">{entry.actor}</span> {entry.did}{" "}
                  <span className="font-medium text-slate-900">{entry.subject}</span>
                </p>
                <span className="text-[10px] text-slate-400 mt-0.5 block font-jetbrains">
                  {entry.when}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="p-3.5 sm:px-5 border-t border-slate-100 flex items-center justify-between text-xs bg-slate-50/40">
        <span className="text-slate-500 font-jetbrains text-[11px]">All operations audited</span>
        <a
          className="font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            showToast("Opening sales team member directory");
          }}
        >
          Team roster →
        </a>
      </div>
    </div>
  );
}
