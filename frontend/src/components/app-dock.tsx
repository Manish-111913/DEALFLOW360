"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCK_POSITION } from "./app-shell";
import { ROUTES } from "@/lib/navigation";

/**
 * The one dock, on every screen.
 *
 * There used to be seven of these - one per screen, each drawn differently. The
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
  badge?: string;
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
    badge: "4",
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
];

export function AppDock() {
  const pathname = usePathname();

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

        // The active tile is a filled pill rather than a link, because it is
        // the page you are already on.
        if (active) {
          return (
            <div
              className="flex flex-col items-center bg-indigo-600 text-white shadow-md rounded-xl font-medium px-3.5 py-1.5 transition-all"
              key={item.label}
            >
              <DockIcon path={item.path} />
              <span className="text-[10px] font-bold mt-0.5">{item.label}</span>
            </div>
          );
        }

        return (
          <Link
            className={
              "flex flex-col items-center px-2.5 py-1 text-slate-500 hover:text-slate-800 transition-colors" +
              (item.badge ? " relative" : "")
            }
            href={item.href}
            key={item.label}
          >
            {item.badge && (
              <span className="absolute -top-0.5 right-2 w-3.5 h-3.5 bg-rose-500 text-white rounded-full text-[9px] font-bold flex items-center justify-center">
                {item.badge}
              </span>
            )}
            <DockIcon path={item.path} />
            <span className="text-[10px] font-medium mt-0.5">{item.label}</span>
          </Link>
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
