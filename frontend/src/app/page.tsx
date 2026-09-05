import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/auth";
import { ROUTES } from "@/lib/navigation";

/**
 * The public landing page - the first thing anyone sees.
 *
 * Three notes on how the source mockup was translated:
 *
 *  - `brand-*` became `indigo-*`. They are the same six hex values, and the
 *    Tailwind config deliberately omits a `brand` palette (see its comment), so
 *    naming indigo directly keeps the colour and adds no dead config.
 *  - `font-sans`/`font-mono` became `font-jakarta`/`font-jetbrains`, because
 *    this project does not override the default families. Naming them is what
 *    makes them real: plain `font-mono` resolves to whatever the browser calls
 *    monospace, which is Consolas on Windows, not the JetBrains Mono the
 *    design asks for.
 *  - Every "Launch Demo"/"Sign In" anchor pointed at `#demo`, an on-page
 *    section. They now point at the real sign-in route; the `#demo` section is
 *    still there and still linked from the footer, as the closing pitch.
 *
 * Signed-in visitors are sent straight to their workspace: having to read the
 * marketing page again on every visit would be a strange way to greet someone
 * who already has an account.
 */
export default async function LandingPage() {
  const user = await getCurrentUser();
  if (user) redirect(user.kind === "PORTAL" ? ROUTES.negotiation : ROUTES.home);

  return (
    <div className="bg-[#fafbfe] text-slate-900 font-jakarta antialiased selection:bg-indigo-100 selection:text-indigo-700">
      {/* 1. NAVBAR */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-slate-200/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link className="flex items-center gap-2.5" href={ROUTES.landing}>
              <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold text-sm tracking-tight shadow-sm shadow-indigo-500/20">
                DF
              </div>
              <span className="text-base font-bold text-slate-900 tracking-tight">
                DealFlow<span className="text-indigo-600">360</span>
              </span>
            </Link>
          </div>
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-600">
            <a className="hover:text-indigo-600 transition-colors" href="#product">
              Product
            </a>
            <a className="hover:text-indigo-600 transition-colors" href="#how-it-works">
              How It Works
            </a>
            <a className="hover:text-indigo-600 transition-colors" href="#capabilities">
              Capabilities
            </a>
          </nav>
          <div className="flex items-center gap-4">
            <Link
              className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
              href="/login"
            >
              Sign In
            </Link>
            <Link
              className="inline-flex items-center justify-center px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 shadow-sm transition-colors"
              href="/login"
            >
              Launch Demo
            </Link>
          </div>
        </div>
      </header>

      {/* 2. HERO */}
      <section
        className="pt-12 pb-16 lg:pt-20 lg:pb-24 border-b border-slate-200/70"
        id="product"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
            <div className="lg:col-span-6 space-y-6 text-center lg:text-left">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/70">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-600" />
                INTELLIGENT SALES OPERATIONS
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-[54px] font-extrabold text-slate-900 tracking-tight leading-[1.12]">
                Every Deal. <br className="hidden sm:inline" />
                <span className="text-indigo-600">One Intelligent Flow.</span>
              </h1>
              <p className="text-base sm:text-lg text-slate-600 font-normal leading-relaxed max-w-xl mx-auto lg:mx-0">
                DealFlow360 connects the entire B2B deal lifecycle — from quotation and approval to
                negotiation, fulfillment, billing, and deal health.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3 pt-1">
                <Link
                  className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3 text-sm font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 shadow-sm transition-all"
                  href="/login"
                >
                  Launch Demo →
                </Link>
                <a
                  className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3 text-sm font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all shadow-xs"
                  href="#how-it-works"
                >
                  Explore How It Works
                </a>
              </div>
              <div className="pt-3 text-xs sm:text-sm font-medium text-slate-500 flex flex-wrap justify-center lg:justify-start items-center gap-2">
                <span>Protect margin</span>
                <span className="text-slate-300">·</span>
                <span>Accelerate approvals</span>
                <span className="text-slate-300">·</span>
                <span>Close with confidence</span>
              </div>
            </div>
            <div className="lg:col-span-6 flex items-center justify-center">
              <div className="w-full max-w-lg">
                {/* eslint-disable-next-line @next/next/no-img-element -- a
                    remote illustration with no known intrinsic size; next/image
                    would need the host allowlisted for one decorative asset. */}
                <img
                  alt="DealFlow360 Intelligent Deal Lifecycle"
                  className="w-full max-w-lg rounded-2xl border border-slate-200/80 shadow-sm object-contain"
                  src="https://lh3.googleusercontent.com/aida/AEtjO1U6G3u_KQAy12ruIxAGTCFOSnnU9ijlu59DDxDqTjpLjaFsDktb3osKqXAYS-B6Hfvf4KUUsDkid5vb7Wun7v_IMpY0hepTrAqx0sZRNN61agWExDF8dKevAoUUIVvgiB5ddrtd6t1QIEG6ek-BiqBeGbVj9OdFT-l6q2GGOjiIr5emlJvY1hzabZGmtoyA5_CLbHBRIRf9JEMA7xsjy3TQvVH_TUpNBcr2VnLIwp2nPKir_lBdRJV5j2Q"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. THE PROBLEM */}
      <section className="py-20 bg-white border-b border-slate-200/70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center space-y-4 mb-12 lg:mb-16">
            <div className="inline-block text-[11px] font-jetbrains font-semibold text-indigo-600 uppercase tracking-widest bg-indigo-50/80 px-2.5 py-1 rounded">
              THE PROBLEM
            </div>
            <h2 className="text-2xl sm:text-3xl lg:text-[34px] font-bold tracking-tight text-slate-900 leading-snug">
              B2B deals are more complicated than a quote.
            </h2>
            <p className="text-sm sm:text-base text-slate-600 leading-relaxed max-w-2xl mx-auto pt-1">
              Discount exceptions, approval delays, customer negotiation, fragmented inventory,
              mixed billing, and deal risk can turn one quotation into a long operational process.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-5xl mx-auto">
            {[
              {
                n: "01",
                title: "Discount & Margin",
                body: "A small pricing exception can affect approval and profitability.",
              },
              {
                n: "02",
                title: "Fragmented Fulfillment",
                body: "One order may depend on stock across multiple warehouses.",
              },
              {
                n: "03",
                title: "Customer Negotiation",
                body: "Terms change after the quote is already sent.",
              },
              {
                n: "04",
                title: "Deal Visibility",
                body: "Risks often become visible only after momentum is lost.",
              },
            ].map((item) => (
              <div
                className="p-5 sm:p-6 rounded-xl border border-slate-200/80 bg-slate-50/40 flex items-start gap-4"
                key={item.n}
              >
                <span className="text-xs font-jetbrains font-semibold text-indigo-600 pt-0.5 w-6 shrink-0">
                  {item.n}
                </span>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-slate-900">{item.title}</h3>
                  <p className="text-xs sm:text-sm text-slate-600 mt-1 leading-relaxed">
                    {item.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 4. CONNECTED LIFECYCLE */}
      <section
        className="py-20 bg-[#fafbfe] border-b border-slate-200/70"
        id="how-it-works"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mx-auto text-center space-y-2 mb-14">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              One deal. One connected lifecycle.
            </h2>
            <p className="text-sm text-slate-600">
              Every critical stage stays connected as the deal changes.
            </p>
          </div>
          <div className="max-w-6xl mx-auto bg-white border border-slate-200/90 rounded-2xl p-6 sm:p-8 shadow-xs relative overflow-hidden">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3 relative z-10">
              {[
                { n: "01", title: "Quotation", sub: "Build the deal" },
                { n: "02", title: "Analyze", sub: "Check margin & risk" },
                { n: "03", title: "Approve", sub: "Route exceptions" },
              ].map((s) => (
                <div
                  className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-col justify-between"
                  key={s.n}
                >
                  <div>
                    <div className="text-[11px] font-jetbrains font-bold text-indigo-600 mb-1">
                      {s.n}
                    </div>
                    <div className="text-sm font-bold text-slate-900">{s.title}</div>
                    <div className="text-xs text-slate-500 mt-1">{s.sub}</div>
                  </div>
                  <div className="hidden lg:flex justify-end text-slate-300 text-xs mt-3">→</div>
                </div>
              ))}

              {/* 04 is the hub: the stage the whole loop re-enters. */}
              <div className="p-4 rounded-xl border-2 border-indigo-500 bg-indigo-50/70 flex flex-col justify-between shadow-xs ring-2 ring-indigo-500/10">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-jetbrains font-bold text-indigo-700">04</span>
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-600 text-white">
                      Dynamic
                    </span>
                  </div>
                  <div className="text-sm font-bold text-indigo-950">Negotiate</div>
                  <div className="text-xs text-indigo-800/90 mt-1">Work with customer</div>
                </div>
                <div className="hidden lg:flex justify-end text-indigo-600 text-xs mt-3 font-semibold">
                  →
                </div>
              </div>

              {[
                { n: "05", title: "Fulfill", sub: "Allocate inventory" },
                { n: "06", title: "Bill", sub: "One-time + recurring" },
              ].map((s) => (
                <div
                  className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-col justify-between"
                  key={s.n}
                >
                  <div>
                    <div className="text-[11px] font-jetbrains font-bold text-indigo-600 mb-1">
                      {s.n}
                    </div>
                    <div className="text-sm font-bold text-slate-900">{s.title}</div>
                    <div className="text-xs text-slate-500 mt-1">{s.sub}</div>
                  </div>
                  <div className="hidden lg:flex justify-end text-slate-300 text-xs mt-3">→</div>
                </div>
              ))}

              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-col justify-between col-span-1 sm:col-span-2 lg:col-span-1">
                <div>
                  <div className="text-[11px] font-jetbrains font-bold text-indigo-600 mb-1">07</div>
                  <div className="text-sm font-bold text-slate-900">Monitor</div>
                  <div className="text-xs text-slate-500 mt-1">Catch issues early</div>
                </div>
                <div className="hidden lg:flex justify-end text-emerald-600 text-xs mt-3 font-semibold">
                  ✓
                </div>
              </div>
            </div>

            <div className="mt-6 pt-5 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-50/70 -mx-6 -mb-6 sm:-mx-8 sm:-mb-8 px-6 sm:px-8 py-4">
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <div className="text-xs text-slate-700 font-medium">
                  <span className="font-bold text-indigo-900">Active Re-entry Loop:</span> Terms
                  changed during negotiation → Automatic loopback re-evaluates margin, tier approval
                  &amp; inventory.
                </div>
              </div>
              <div className="inline-flex items-center gap-1.5 text-xs font-jetbrains font-semibold text-indigo-600 bg-indigo-50 border border-indigo-200/80 px-2.5 py-1 rounded-full shrink-0">
                <span>Terms changed</span>
                <span>→</span>
                <span>Re-evaluate</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 5. HOW IT THINKS */}
      <section className="py-12 bg-slate-100/60 border-b border-slate-200/70">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <h3 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight">
                When the deal changes, DealFlow360 responds.
              </h3>
              <div className="flex items-center gap-2 text-[11px] font-jetbrains font-bold text-slate-400">
                <span className="text-indigo-600">CHANGE</span>
                <span>→</span>
                <span className="text-indigo-600">UNDERSTAND</span>
                <span>→</span>
                <span className="text-indigo-600">DECIDE</span>
                <span>→</span>
                <span className="text-indigo-600">ACT</span>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 pt-1 text-xs">
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/60">
                <span className="text-[10px] font-jetbrains uppercase text-slate-400 font-semibold block mb-0.5">
                  Change
                </span>
                <span className="font-semibold text-slate-800">Customer requests 17% discount</span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/60">
                <span className="text-[10px] font-jetbrains uppercase text-slate-400 font-semibold block mb-0.5">
                  Understand
                </span>
                <span className="font-medium text-slate-700">Risk and margin re-evaluated</span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/60">
                <span className="text-[10px] font-jetbrains uppercase text-slate-400 font-semibold block mb-0.5">
                  Decide
                </span>
                <span className="font-medium text-slate-700">Approval requirement recalculated</span>
              </div>
              <div className="p-2.5 rounded-lg bg-indigo-50/70 border border-indigo-200/80">
                <span className="text-[10px] font-jetbrains uppercase text-indigo-600 font-semibold block mb-0.5">
                  Act
                </span>
                <span className="font-semibold text-indigo-900">Next action surfaced</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 6. CAPABILITIES */}
      <section className="py-20 bg-white border-b border-slate-200/70" id="capabilities">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mx-auto text-center space-y-2 mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              Everything the deal needs, in one flow.
            </h2>
            <p className="text-xs sm:text-sm text-slate-600">
              Focused capabilities designed to eliminate friction across cross-functional deal teams.
            </p>
          </div>
          <div className="max-w-5xl mx-auto space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7 p-6 rounded-xl border border-slate-200 bg-slate-50/40 flex flex-col justify-between">
                <div>
                  <div className="text-[11px] font-jetbrains font-semibold text-indigo-600 uppercase tracking-wider mb-2">
                    PRICING GOVERNANCE
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-2">
                    Intelligent Pricing Governance
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                    Customer- and category-aware discount limits automatically determine when
                    approval is required.
                  </p>
                </div>
                <div className="mt-6 pt-5 border-t border-slate-200/70">
                  <div className="bg-white border border-slate-200 rounded-lg p-3.5 shadow-2xs space-y-2.5 text-xs font-jetbrains">
                    <div className="flex items-center justify-between text-slate-500 text-[11px]">
                      <span>RULE CHECK: ENTERPRISE_TIER_A</span>
                      <span className="text-indigo-600 font-semibold">DF-GOV-09</span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex items-center gap-3">
                        <div>
                          <span className="text-slate-400 block text-[10px]">REQUESTED</span>
                          <span className="font-bold text-slate-800 text-sm">18%</span>
                        </div>
                        <div className="text-slate-300">|</div>
                        <div>
                          <span className="text-slate-400 block text-[10px]">ALLOWED</span>
                          <span className="font-semibold text-slate-700 text-sm">10%</span>
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-50 text-amber-800 border border-amber-200 text-xs font-semibold">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        Approval Required
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="lg:col-span-5 space-y-6 flex flex-col justify-between">
                <div className="p-6 rounded-xl border border-slate-200 bg-slate-50/40 h-full flex flex-col justify-center">
                  <div className="text-[11px] font-jetbrains font-semibold text-emerald-600 uppercase tracking-wider mb-2">
                    MARGIN OPTIMIZATION
                  </div>
                  <h3 className="text-base font-bold text-slate-900 mb-1.5">Margin-Aware Selling</h3>
                  <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                    Relevant upsell and cross-sell suggestions with immediate margin impact.
                  </p>
                </div>
                <div className="p-6 rounded-xl border border-slate-200 bg-slate-50/40 h-full flex flex-col justify-center">
                  <div className="text-[11px] font-jetbrains font-semibold text-indigo-600 uppercase tracking-wider mb-2">
                    LOGISTICS ALLOCATION
                  </div>
                  <h3 className="text-base font-bold text-slate-900 mb-1.5">Adaptive Fulfillment</h3>
                  <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                    Warehouse-aware allocation, split shipments, and backorder handling.
                  </p>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-6 rounded-xl border border-slate-200 bg-slate-50/40">
                <div className="text-[11px] font-jetbrains font-semibold text-indigo-600 uppercase tracking-wider mb-2">
                  REVENUE OPERATIONS
                </div>
                <h3 className="text-base font-bold text-slate-900 mb-1.5">Hybrid Billing</h3>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                  One-time products and recurring services managed within the same order.
                </p>
              </div>
              <div className="p-6 rounded-xl border border-slate-200 bg-slate-50/40">
                <div className="text-[11px] font-jetbrains font-semibold text-amber-600 uppercase tracking-wider mb-2">
                  LIFECYCLE VISIBILITY
                </div>
                <h3 className="text-base font-bold text-slate-900 mb-1.5">
                  Customer Negotiation + Deal Health
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                  Live customer negotiation plus visibility into stalled, risky, or changing deals.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 7. DEAL STORY */}
      <section className="py-20 bg-[#fafbfe] border-b border-slate-200/70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mx-auto text-center space-y-2 mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              See how one deal evolves.
            </h2>
            <p className="text-xs sm:text-sm text-slate-600">
              A single deal can change many times before it closes. DealFlow360 keeps every decision
              connected.
            </p>
          </div>
          <div className="max-w-4xl mx-auto bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3.5 mb-5 text-xs">
              <div className="font-jetbrains font-bold text-indigo-700 tracking-wider">
                ACME INDUSTRIES · ₹10,00,000 DEAL
              </div>
              <div className="text-slate-400 font-jetbrains text-[11px]">LIFECYCLE AUDIT TRAIL</div>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-2.5 text-xs text-slate-700">
              <span className="font-medium bg-slate-100 text-slate-800 px-3 py-1.5 rounded-lg border border-slate-200/60">
                18% Discount
              </span>
              <span className="text-slate-300">→</span>
              <span className="font-medium bg-amber-50 text-amber-800 border border-amber-200 px-3 py-1.5 rounded-lg">
                Approval Required
              </span>
              <span className="text-slate-300">→</span>
              <span className="font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 px-3 py-1.5 rounded-lg">
                Customer Counter-Offer: 17%
              </span>
              <span className="text-slate-300">→</span>
              <span className="font-medium bg-slate-100 text-slate-800 px-3 py-1.5 rounded-lg border border-slate-200/60">
                Deal Re-evaluated
              </span>
              <span className="text-slate-300">→</span>
              <span className="font-medium bg-slate-100 text-slate-800 px-3 py-1.5 rounded-lg border border-slate-200/60">
                Warehouse Allocation: 12 + 8 units
              </span>
              <span className="text-slate-300">→</span>
              <span className="font-medium bg-slate-100 text-slate-800 px-3 py-1.5 rounded-lg border border-slate-200/60">
                One-Time + Recurring Billing
              </span>
              <span className="text-slate-300">→</span>
              <span className="font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 px-3 py-1.5 rounded-lg">
                Deal Confirmed
              </span>
            </div>
            <p className="text-center text-xs text-slate-500 mt-6 pt-4 border-t border-slate-100">
              Every change is evaluated against the current commercial, approval, fulfillment, and
              billing state.
            </p>
          </div>
        </div>
      </section>

      {/* 8. DEAL INTELLIGENCE */}
      <section className="py-16 bg-white border-b border-slate-200/70">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl border border-indigo-100 bg-gradient-to-b from-indigo-50/40 to-slate-50/50 p-6 sm:p-8 space-y-6">
            <div className="space-y-2">
              <div className="inline-block text-[11px] font-jetbrains font-semibold text-indigo-600 uppercase tracking-widest bg-indigo-100/60 px-2.5 py-0.5 rounded">
                GEMINI-POWERED DEAL INTELLIGENCE
              </div>
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
                Intelligence where decisions happen.
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed max-w-2xl">
                DealFlow360 uses Gemini to help users understand deals, compare commercial options,
                explain risk, and identify the next useful action — while business rules remain
                authoritative.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { tag: "Understand", q: "“Why is this deal at risk?”" },
                { tag: "Compare", q: "“What happens if we reduce the discount?”" },
                { tag: "Act", q: "“What should I do next?”" },
              ].map((chip) => (
                <div
                  className="p-3.5 rounded-lg bg-white border border-slate-200/80 shadow-2xs"
                  key={chip.tag}
                >
                  <span className="text-[10px] font-jetbrains font-bold text-indigo-600 uppercase tracking-wider block mb-1">
                    {chip.tag}
                  </span>
                  <p className="text-xs font-medium text-slate-800">{chip.q}</p>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 italic pt-1 border-t border-slate-200/60">
              Business rules govern validation and execution; Gemini assists with comprehension and
              reasoning. Not a generic chatbot popup.
            </p>
          </div>
        </div>
      </section>

      {/* 9. FINAL CTA */}
      <section className="py-20 bg-[#0f172a] text-white" id="demo">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-6">
          <div className="space-y-2">
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
              Stop managing disconnected deal steps.
            </h2>
            <p className="text-xl sm:text-2xl font-semibold text-indigo-300">
              Start orchestrating the deal.
            </p>
          </div>
          <p className="text-sm sm:text-base text-slate-300 max-w-xl mx-auto leading-relaxed">
            DealFlow360 connects pricing, approval, negotiation, fulfillment, billing, and deal
            health in one continuous flow.
          </p>
          <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              className="w-full sm:w-auto inline-flex items-center justify-center px-7 py-3.5 text-sm font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-500 shadow-sm transition-all"
              href="/login"
            >
              Launch DealFlow360 →
            </Link>
            <a
              className="text-sm font-medium text-slate-300 hover:text-white transition-colors"
              href="#capabilities"
            >
              Explore the platform
            </a>
          </div>
        </div>
      </section>

      {/* 10. FOOTER */}
      <footer className="bg-white border-t border-slate-200 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-900">DealFlow360</span>
              <span className="text-slate-300">·</span>
              <span>Intelligent Sales Operations</span>
            </div>
            <div className="flex items-center gap-6 font-medium text-slate-600">
              <a className="hover:text-indigo-600 transition-colors" href="#product">
                Product
              </a>
              <a className="hover:text-indigo-600 transition-colors" href="#how-it-works">
                How It Works
              </a>
              <a className="hover:text-indigo-600 transition-colors" href="#capabilities">
                Capabilities
              </a>
              <a className="hover:text-indigo-600 transition-colors" href="#demo">
                Demo
              </a>
            </div>
            <div>© 2026 DealFlow360. All rights reserved.</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
