"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCK_POSITION } from "./app-shell";
import { ROUTES } from "@/lib/navigation";
import { useShellStatus } from "@/lib/use-shell-status";

/**
 * The one dock, on every screen.
 *
 * There used to be one of these per screen, each drawn differently. The
 * tiles were 48px squares on approvals, 56px on deal health and padded pills on
 * billing; labels were 9px, 10px and 11px; the last two were called
 * "Negotiation"/"Deal Health" on the command centre and "Negotiate"/"Health"
 * everywhere else; and the icons for Sales, Billing and Health were three
 * different glyphs depending on the page. Because the dock sits at the bottom
 * of every screen, that made the whole bottom strip shift on each navigation
 * even after the window, footer and agent had been unified.
 *
 * This is billing's dock, and nothing about it varies by page. The active tile
 * is worked out from the current route rather than passed in, so a screen
 * cannot render the dock with the wrong item lit or forget to update it.
 */

interface DockItem {
  href: string;
  label: string;
  path: string;
  /** Draws a hairline before this tile, separating configuration from work. */
  separated?: boolean;
}

const ITEMS: DockItem[] = [
  {
    href: ROUTES.home,
    label: "Home",
    path: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  },
  {
    href: ROUTES.sales,
    label: "Sales",
    path: "M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
  },
  {
    href: ROUTES.approvals,
    label: "Approvals",
    // The count is live - see `badgeFor` below. It used to be the string "4",
    // which stayed 4 after you cleared the queue.
    path: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
  },
  {
    href: ROUTES.fulfillment,
    label: "Fulfillment",
    path: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
  },
  {
    href: ROUTES.billing,
    label: "Billing",
    path: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z",
  },
  {
    href: ROUTES.negotiation,
    label: "Negotiate",
    path: "M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4",
  },
  {
    href: ROUTES.dealHealth,
    label: "Health",
    path: "M13 10V3L4 14h7v7l9-11h-7z",
  },
  {
    href: ROUTES.settings,
    label: "Settings",
    // Set apart because it is not another place to work - it is where the
    // rules the other tiles operate under are changed.
    separated: true,
    path: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z",
  },
  {
    href: ROUTES.accounts,
    label: "Accounts",
    path: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z",
  },
];

export function AppDock() {
  const pathname = usePathname();
  const { pendingApprovals } = useShellStatus();

  /**
   * How many things are actually waiting on this person.
   *
   * Null while it is still loading, and hidden at zero: a badge reading "0" is
   * worse than no badge, because it draws the eye to nothing.
   */
  const badgeFor = (label: string): string | undefined =>
    label === "Approvals" && pendingApprovals ? String(pendingApprovals) : undefined;

  return (
    <nav
      aria-label="Quick Access Dock"
      className={
        DOCK_POSITION +
        " bg-white/95 backdrop-blur-md px-3 sm:px-4 py-1.5 rounded-2xl shadow-xl border border-slate-200/90 flex items-center gap-1 sm:gap-2"
      }
    >
      {ITEMS.map((item) => {
        const active = pathname === item.href;
        const divider = item.separated ? (
          <div className="w-px h-6 bg-slate-200 mx-0.5" key={item.label + "-divider"} />
        ) : null;

        // The active tile is a filled pill rather than a link, because it is
        // the page you are already on.
        if (active) {
          return (
            <Fragment key={item.label}>
              {divider}
              <div className="flex flex-col items-center bg-indigo-600 text-white shadow-md rounded-xl font-medium px-3.5 py-1.5 transition-all">
                <DockIcon path={item.path} />
                <span className="text-[10px] font-bold mt-0.5">{item.label}</span>
              </div>
            </Fragment>
          );
        }

        return (
          <Fragment key={item.label}>
          {divider}
          <Link
            className={
              "flex flex-col items-center px-2.5 py-1 text-slate-500 hover:text-slate-800 transition-colors" +
              (badgeFor(item.label) ? " relative" : "")
            }
            href={item.href}
          >
            {badgeFor(item.label) && (
              <span className="absolute -top-0.5 right-2 w-3.5 h-3.5 bg-rose-500 text-white rounded-full text-[9px] font-bold flex items-center justify-center">
                {badgeFor(item.label)}
              </span>
            )}
            <DockIcon path={item.path} />
            <span className="text-[10px] font-medium mt-0.5">{item.label}</span>
          </Link>
          </Fragment>
        );
      })}
    </nav>
  );
}

function DockIcon({ path }: { path: string }) {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path d={path} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}
