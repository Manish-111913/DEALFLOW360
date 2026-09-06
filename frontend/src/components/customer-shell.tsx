import Link from "next/link";

/**
 * The customer portal's window furniture.
 *
 * Deliberately its own shell rather than the internal `AppShell`. The two
 * surfaces are for different people and must not share chrome: the internal
 * dock links to Approvals and Deal Health, and the internal status bar quotes a
 * build number and sync latency. Neither belongs in front of a customer, and
 * keeping one shell with props would be exactly the mechanism by which one of
 * them eventually appeared there.
 *
 * The three customer screens were drawn with identical furniture - same header,
 * same pinned telemetry bar, same floating dock - so it is defined once here
 * and imported, which is also what fixes the My Quotations screen: it had been
 * drawn with a five-item dock while the other two used three.
 */

/** The dot-grid desktop the window floats on. */
export function CustomerDesktop({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen customer-desktop font-jakarta antialiased text-slate-800 p-3 sm:p-6 pb-24 flex flex-col justify-start items-center overflow-y-auto relative">
      {children}
    </div>
  );
}

/** The macOS-style window every customer screen sits inside. */
export function CustomerWindow({ children }: { children: React.ReactNode }) {
  return (
    <main className="w-full max-w-6xl bg-white border border-slate-200/90 rounded-2xl shadow-2xl shadow-slate-300/40 overflow-hidden flex flex-col min-h-[820px] my-auto">
      {children}
    </main>
  );
}

export interface CustomerHeaderProps {
  /** The trail after "DealFlow360 / Customer Portal". */
  page: string;
  /** Rendered as a back link on the detail screens. */
  backHref?: string;
  backLabel?: string;
  /** The live quote reference shown in the green pill, when on one deal. */
  quoteNumber?: string | null;
  customerName: string;
  /** Right-hand slot, for the detail screen's view switcher. */
  children?: React.ReactNode;
}

export function CustomerHeader({
  page,
  backHref,
  backLabel = "My Quotations",
  quoteNumber = null,
  customerName,
  children,
}: CustomerHeaderProps) {
  const initial = customerName.trim().charAt(0).toUpperCase() || "C";

  return (
    <header className="px-5 py-3 border-b border-slate-100 bg-white flex items-center justify-between select-none shrink-0">
      <div className="flex items-center space-x-3 sm:space-x-4 min-w-0">
        <div className="flex items-center space-x-1.5 shrink-0">
          <span className="w-3 h-3 rounded-full bg-[#ff5f56] inline-block border border-[#e0443e]" />
          <span className="w-3 h-3 rounded-full bg-[#ffbd2e] inline-block border border-[#dea123]" />
          <span className="w-3 h-3 rounded-full bg-[#27c93f] inline-block border border-[#1aab29]" />
        </div>

        <nav
          aria-label="Breadcrumb"
          className="hidden sm:flex items-center space-x-2 text-xs font-medium text-slate-500 min-w-0"
        >
          {backHref && (
            <>
              <Link
                className="hover:text-indigo-600 transition-colors flex items-center gap-1 font-semibold text-slate-600 shrink-0"
                href={backHref}
              >
                <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M10 19l-7-7m0 0l7-7m-7 7h18" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                </svg>
                {backLabel}
              </Link>
              <span className="text-slate-300">/</span>
            </>
          )}
          <span className="text-slate-900 font-semibold tracking-tight">DealFlow360</span>
          <span className="text-slate-300">/</span>
          <span className="text-slate-600">Customer Portal</span>
          <span className="text-slate-300">/</span>
          <span className="text-slate-400 truncate">{page}</span>
        </nav>

        {quoteNumber && (
          <div className="hidden md:flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200/70 text-[11px] font-medium text-emerald-700 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>Live Quotation</span>
            <span className="text-emerald-400">•</span>
            <span className="font-jetbrains text-emerald-800 font-semibold">{quoteNumber}</span>
          </div>
        )}
      </div>

      <div className="flex items-center space-x-2 sm:space-x-3 shrink-0">
        <a
          className="hidden sm:inline-flex items-center space-x-1 px-2.5 py-1 text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors"
          href="mailto:support@dealflow360.com"
        >
          <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
          </svg>
          <span>Support &amp; FAQ</span>
        </a>

        <div className="flex items-center space-x-2 pl-2 border-l border-slate-200">
          <div className="w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-xs tracking-tight">
            {initial}
          </div>
          <div className="text-left hidden lg:block leading-tight">
            <p className="text-xs font-semibold text-slate-800">{customerName}</p>
            <p className="text-[10px] text-slate-400">Enterprise Procurement</p>
          </div>
        </div>

        {children}
      </div>
    </header>
  );
}

/**
 * The pinned telemetry bar.
 *
 * Prop-less, like the internal `StatusBar` and for the same reason: it is the
 * one piece of furniture most likely to drift if each screen could pass "just
 * one" of its own details.
 */
export function CustomerStatusBar() {
  return (
    <footer className="shrink-0 border-t border-slate-200/80 bg-white px-5 py-2.5 text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-3 select-none">
      <div className="flex items-center space-x-3">
        <span className="inline-flex items-center text-emerald-700 font-medium">
          <span className="w-2 h-2 rounded-full bg-emerald-500 mr-1.5" />
          Database: Connected (Asia-South-1)
        </span>
        <span className="text-slate-300">·</span>
        <span>
          Currency: <strong className="text-slate-700 font-semibold">INR (₹)</strong>
        </span>
        <span className="text-slate-300 hidden sm:inline">·</span>
        <span className="hidden sm:inline">
          Customer Gateway: <strong className="text-slate-700 font-semibold">Secure 256-bit TLS</strong>
        </span>
      </div>
      <div className="flex items-center space-x-3">
        <span>
          DealFlow360 Customer Portal{" "}
          <span className="font-jetbrains text-slate-600 font-medium">v4.2.8 Enterprise</span>
        </span>
        <span className="text-slate-300">·</span>
        <a className="hover:text-indigo-600 transition-colors" href="mailto:support@dealflow360.com">
          24/7 Enterprise Support
        </a>
      </div>
    </footer>
  );
}

export type CustomerDockTab = "quotes" | "confirmed";

/**
 * The floating dock: two destinations, not seven.
 *
 * A customer has one job here - read a quote, ask for a change, confirm it -
 * and the dock says so. The internal dock's Approvals, Fulfilment, Billing and
 * Deal Health are not places a customer can go.
 *
 * Negotiation is not a dock entry, because it is not a destination: asking for
 * a change happens on the quotation itself, through "Request Commercial
 * Revision", and a dock tile pointing back at the page you are already on is
 * navigation that does nothing. Confirmed is a link only when there is a quote
 * in view; otherwise it renders as plainly unavailable rather than as a button
 * that goes nowhere.
 */
export function CustomerDock({
  active,
  quotationId = null,
}: {
  active: CustomerDockTab;
  quotationId?: string | null;
}) {
  const items: { key: CustomerDockTab; label: string; href: string | null; icon: React.ReactNode }[] = [
    {
      key: "quotes",
      label: "My Quotes / Home",
      href: "/my/quotations",
      icon: (
        <path
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      ),
    },
    {
      key: "confirmed",
      label: "Confirmed",
      href: quotationId ? `/my/quotations/${quotationId}/confirmed` : null,
      icon: <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />,
    },
  ];

  return (
    <nav
      aria-label="Customer Portal navigation"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 bg-white/95 backdrop-blur-md border border-slate-200/80 shadow-lg rounded-2xl px-2 py-1.5 flex items-center gap-1.5"
    >
      {items.map((item) => {
        const isActive = item.key === active;
        const className = isActive
          ? "bg-indigo-600 text-white px-4 py-2 rounded-xl flex items-center gap-2 font-medium text-xs shadow-sm"
          : "px-3.5 py-2 rounded-xl text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100/80 transition-all flex items-center gap-2";

        const content = (
          <>
            <svg
              className={`w-4 h-4 ${isActive ? "text-white" : "text-slate-500"}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              {item.icon}
            </svg>
            <span>{item.label}</span>
          </>
        );

        if (!item.href) {
          return (
            <span
              className="px-3.5 py-2 rounded-xl text-xs font-medium text-slate-300 flex items-center gap-2 cursor-not-allowed"
              key={item.key}
              title="Open a quotation first"
            >
              {content}
            </span>
          );
        }

        return (
          <Link className={className} href={item.href} key={item.key}>
            {content}
          </Link>
        );
      })}
    </nav>
  );
}

/** How each customer-facing status is coloured. One place, three screens. */
export const CUSTOMER_STATUS_STYLE: Record<string, string> = {
  Sent: "bg-slate-100 text-slate-700 border-slate-200",
  "Under Negotiation": "bg-amber-50 text-amber-800 border-amber-200",
  "Under Review": "bg-amber-50 text-amber-800 border-amber-200",
  "Ready to Confirm": "bg-indigo-50 text-indigo-700 border-indigo-200",
  Confirmed: "bg-emerald-50 text-emerald-800 border-emerald-200",
};

export function CustomerStatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
        CUSTOMER_STATUS_STYLE[status] ?? CUSTOMER_STATUS_STYLE.Sent
      }`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
      {status}
    </span>
  );
}
