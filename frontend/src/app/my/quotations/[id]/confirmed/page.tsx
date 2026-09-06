import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentBusinessTime, prisma, viewPortalQuotation } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import {
  CustomerDesktop,
  CustomerDock,
  CustomerHeader,
  CustomerStatusBar,
} from "@/components/customer-shell";
import { formatRupees } from "@/lib/money";
import { ROUTES } from "@/lib/navigation";
import { assertServesPortal } from "@/lib/surface";

/**
 * Screen C3 - Confirmation & Status.
 *
 * The mockup carried four states behind a preview dropdown: confirmed, under
 * review, updated, and expired. They are not preview states here - each one is
 * a real position the quotation can actually be in, so the screen reads the
 * quotation and shows the one that is true.
 *
 *   Confirmed        -> the order exists; here is what happens next
 *   Under Review     -> the seller is assessing a request; nothing to do yet
 *   Ready to Confirm -> terms were revised and are waiting on the customer
 *   Expired          -> past its validity date and no longer confirmable
 *
 * Which means this page can never claim a confirmation that did not happen: the
 * success state renders only when the quotation really is CONFIRMED.
 */
export default async function ConfirmationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  assertServesPortal();

  const user = await getCurrentUser();

  if (!user) redirect(`/login?callbackUrl=/my/quotations/${id}/confirmed`);
  if (user.kind !== "PORTAL") redirect(ROUTES.home);

  const result = await viewPortalQuotation(user, id);
  if (result.status !== 200 || !result.quotation) notFound();

  const quotation = result.quotation;
  const customer = user.customerId
    ? await prisma.customer.findUnique({ where: { id: user.customerId }, select: { name: true } })
    : null;
  const customerName = customer?.name ?? "your organisation";

  // Business time, not the host clock (D3) - so a time-travelled demo ages
  // quotations the way it ages everything else. It is also the only reading
  // React's purity rule permits here: reading the host clock during render is
  // not idempotent, so the same render could disagree with itself.
  const now = currentBusinessTime().getTime();
  const expired =
    quotation.status !== "Confirmed" &&
    quotation.validUntil !== null &&
    new Date(quotation.validUntil).getTime() < now;

  const state = expired ? "Expired" : quotation.status;

  return (
    <CustomerDesktop>
      <main className="w-full max-w-6xl bg-white border border-slate-200/90 rounded-2xl shadow-2xl shadow-slate-300/40 overflow-hidden flex flex-col min-h-[820px] max-h-[calc(100vh-4rem)] my-auto">
        <CustomerHeader
          backHref="/my/quotations"
          customerName={customerName}
          page="Confirmation &amp; Status"
          quoteNumber={quotation.quoteNumber}
        />

        <div className="flex-1 min-h-0 overflow-y-auto app-scroll p-4 sm:p-10 flex items-start justify-center bg-[#fafbfe]">
          <section className="w-full max-w-3xl bg-white border border-slate-200/90 rounded-2xl p-6 sm:p-10 my-auto">
            <Hero customerName={customerName} state={state} />

            <div className="bg-slate-50/80 border border-slate-200/80 rounded-xl p-6 mt-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <div className="text-lg font-semibold text-slate-900">
                  Quotation #{quotation.quoteNumber}
                </div>
                <div className="text-sm text-slate-500 mt-0.5">
                  {quotation.lines.length} item{quotation.lines.length === 1 ? "" : "s"} ·{" "}
                  {quotation.lines
                    .slice(0, 2)
                    .map((line) => line.productName)
                    .join(", ")}
                </div>
              </div>
              <div className="sm:text-right flex flex-col items-start sm:items-end gap-1">
                <span className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
                  {state === "Confirmed" ? "Total Contract Value" : "Quotation Value"}
                </span>
                <div className="text-2xl font-bold text-slate-900 font-jetbrains">
                  {formatRupees(quotation.totalAmount)}
                </div>
                <span
                  className={`text-xs px-2.5 py-0.5 rounded-full font-medium inline-block mt-0.5 ${
                    state === "Confirmed"
                      ? "bg-emerald-100 text-emerald-800"
                      : state === "Expired"
                        ? "bg-slate-200 text-slate-700"
                        : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {state}
                </span>
              </div>
            </div>

            {state === "Confirmed" && <WhatHappensNext />}

            <div className="mt-8 pt-6 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
              <Link
                className="text-slate-600 hover:text-slate-900 font-medium text-xs px-2 py-2 transition-colors flex items-center gap-1.5 order-2 sm:order-1"
                href="/my/quotations"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M10 19l-7-7m0 0l7-7m-7 7h18" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                </svg>
                Back to My Quotations
              </Link>
              <Link
                className="w-full sm:w-auto inline-flex items-center justify-center bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-6 py-2.5 rounded-lg transition-colors text-xs order-1 sm:order-2"
                href={`/my/quotations/${id}`}
              >
                <span>
                  {state === "Ready to Confirm" ? "Review & Confirm" : "View Quotation Details"}
                </span>
                <svg className="w-4 h-4 ml-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M14 5l7 7m0 0l-7 7m7-7H3" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                </svg>
              </Link>
            </div>
          </section>
        </div>

        <CustomerStatusBar />
      </main>

      <CustomerDock active="confirmed" quotationId={id} />
    </CustomerDesktop>
  );
}

/** The headline, which is the one thing that differs between the four states. */
function Hero({ state, customerName }: { state: string; customerName: string }) {
  const content: Record<string, { tone: string; icon: React.ReactNode; title: string; body: string }> = {
    Confirmed: {
      tone: "bg-emerald-50 border-emerald-200 text-emerald-600 ring-emerald-50/50",
      icon: <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />,
      title: "Quotation Confirmed",
      body: `Thank you, ${customerName}. Your quotation has been successfully confirmed.`,
    },
    "Under Review": {
      tone: "bg-amber-50 border-amber-200 text-amber-600 ring-amber-50/50",
      icon: (
        <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      ),
      title: "Your request is under review",
      body: "The sales team is reviewing your requested changes. We will update this quotation once it has been assessed.",
    },
    "Under Negotiation": {
      tone: "bg-amber-50 border-amber-200 text-amber-600 ring-amber-50/50",
      icon: (
        <path
          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      ),
      title: "Negotiation in progress",
      body: "Your request has been sent to the sales team and this quotation is still open.",
    },
    "Ready to Confirm": {
      tone: "bg-indigo-50 border-indigo-200 text-indigo-600 ring-indigo-50/50",
      icon: (
        <path
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      ),
      title: "Your quotation is ready",
      body: "The revised quotation has been approved and is ready for your review and confirmation.",
    },
    Expired: {
      tone: "bg-slate-100 border-slate-200 text-slate-500 ring-slate-100/50",
      icon: (
        <path
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      ),
      title: "Quotation unavailable",
      body: "This quotation has passed its validity date and is no longer available for confirmation.",
    },
  };

  const shown = content[state] ?? content.Sent ?? content["Under Review"];

  return (
    <div className="flex flex-col items-center text-center">
      <div className={`w-16 h-16 rounded-full border flex items-center justify-center mb-4 ring-8 ${shown.tone}`}>
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {shown.icon}
        </svg>
      </div>
      <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">{shown.title}</h1>
      <p className="text-slate-600 text-base mt-2 max-w-lg">{shown.body}</p>
    </div>
  );
}

/** The three-step outlook, shown only once there is really an order. */
function WhatHappensNext() {
  return (
    <div className="mt-8">
      <h2 className="text-lg font-semibold text-slate-900 mb-4">What happens next?</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
        <div className="bg-white border border-emerald-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2.5">
            <span className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold">
              ✓
            </span>
            <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
              Completed
            </span>
          </div>
          <h3 className="font-bold text-slate-900 text-sm">1. Quotation</h3>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            Confirmed with negotiated terms and authorised for execution.
          </p>
        </div>

        <div className="bg-white border-2 border-indigo-500 rounded-xl p-4 ring-2 ring-indigo-50">
          <div className="flex items-center justify-between mb-2.5">
            <span className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-bold">
              2
            </span>
            <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
              Preparing your order
            </span>
          </div>
          <h3 className="font-bold text-slate-900 text-sm">2. Fulfilment</h3>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            Hardware preparation and consignment dispatch.
          </p>
        </div>

        <div className="bg-slate-50/70 border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2.5">
            <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-xs font-bold">
              3
            </span>
            <span className="text-[11px] font-medium text-slate-500 bg-slate-200/70 px-2 py-0.5 rounded">
              Upcoming
            </span>
          </div>
          <h3 className="font-bold text-slate-700 text-sm">3. Billing</h3>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            Invoicing will follow according to the agreed quotation terms.
          </p>
        </div>
      </div>
    </div>
  );
}
