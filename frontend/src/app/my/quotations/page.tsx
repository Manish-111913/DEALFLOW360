import Link from "next/link";
import { redirect } from "next/navigation";
import { listMyQuotations, prisma } from "@dealflow/backend";
import { getCurrentUser } from "@/auth";
import {
  CustomerDesktop,
  CustomerDock,
  CustomerHeader,
  CustomerStatusBar,
  CustomerStatusPill,
} from "@/components/customer-shell";
import { formatRupees } from "@/lib/money";
import { ROUTES } from "@/lib/navigation";
import { assertServesPortal } from "@/lib/surface";

/**
 * Screen C1 - My Quotations.
 *
 * The customer's whole book with this seller. Every row comes from
 * `listMyQuotations`, which scopes to their own customer and projects a
 * customer-safe shape server-side - so there is nothing on this page that the
 * markup is responsible for hiding.
 *
 * An internal user who lands here is sent back to their own workspace rather
 * than shown a customer's view of the world.
 */
export default async function MyQuotationsPage() {
  assertServesPortal();

  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/my/quotations");
  if (user.kind !== "PORTAL") redirect(ROUTES.home);

  const result = await listMyQuotations(user);
  if (result.status !== 200) redirect("/login?callbackUrl=/my/quotations");

  const quotations = result.quotations;
  const customer = user.customerId
    ? await prisma.customer.findUnique({
        where: { id: user.customerId },
        select: { name: true },
      })
    : null;
  const customerName = customer?.name ?? "Your account";

  // "Open" is anything the customer can still act on or is waiting to hear
  // about; "settled" is everything already agreed. The split is the screen's
  // whole information architecture, so it is derived here rather than filtered
  // twice in the markup below.
  const open = quotations.filter((q) => q.status !== "Confirmed");
  const settled = quotations.filter((q) => q.status === "Confirmed");

  const sum = (rows: typeof quotations) =>
    rows.reduce((total, row) => total + Number(row.totalAmount), 0).toFixed(2);

  const counts = {
    negotiating: quotations.filter((q) => q.status === "Under Negotiation").length,
    review: quotations.filter((q) => q.status === "Under Review").length,
    ready: quotations.filter((q) => q.status === "Ready to Confirm").length,
    confirmed: settled.length,
  };

  return (
    <CustomerDesktop>
      <CustomerWindowShell customerName={customerName}>
        {/* Title block */}
        <div className="px-6 sm:px-8 pt-6 pb-5 border-b border-slate-100 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">My Quotations</h1>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/70">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Live Portal
              </span>
            </div>
            <p className="text-sm text-slate-500 mt-1 max-w-xl">
              Review your quotations, continue ongoing negotiations, and confirm approved commercial
              offers.
            </p>
          </div>

          <div className="flex items-center gap-3 text-xs bg-slate-50/80 border border-slate-200/80 rounded-xl px-4 py-2.5">
            <div>
              <span className="text-slate-500">Account: </span>
              <span className="font-semibold text-slate-900">{customerName}</span>
            </div>
            <span className="text-slate-300">|</span>
            <div>
              <span className="text-slate-500">Open: </span>
              <span className="font-semibold text-indigo-700">{open.length}</span>
            </div>
          </div>
        </div>

        {/* Portfolio strip */}
        <div className="px-6 sm:px-8 py-3 border-b border-slate-100 bg-slate-50/60 flex flex-wrap items-center gap-x-8 gap-y-2 text-xs">
          <Figure label="Total Portfolio Value" value={formatRupees(sum(quotations))} />
          <Figure
            label="Under Negotiation"
            tone="text-amber-700"
            value={`${counts.negotiating} (${formatRupees(sum(quotations.filter((q) => q.status === "Under Negotiation")))})`}
          />
          <Figure
            label="Under Review"
            tone="text-amber-700"
            value={`${counts.review} (${formatRupees(sum(quotations.filter((q) => q.status === "Under Review")))})`}
          />
          <Figure
            label="Ready to Confirm"
            tone="text-indigo-700"
            value={`${counts.ready} (${formatRupees(sum(quotations.filter((q) => q.status === "Ready to Confirm")))})`}
          />
          <Figure
            label="Confirmed"
            tone="text-emerald-700"
            value={`${counts.confirmed} (${formatRupees(sum(settled))})`}
          />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto app-scroll p-6 sm:p-8 space-y-6 bg-[#fafbfe]">
          {quotations.length === 0 && (
            <div className="bg-white border border-slate-200/90 rounded-2xl p-10 text-center">
              <p className="text-sm font-bold text-slate-900">No quotations yet</p>
              <p className="text-xs text-slate-500 mt-1">
                When your account manager shares a quotation with you, it will appear here.
              </p>
            </div>
          )}

          {open.length > 0 && (
            <section className="bg-white border border-slate-200/90 rounded-2xl overflow-hidden">
              <div className="p-5 sm:p-6 border-b border-slate-100 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-base font-bold text-slate-900">
                      Active Quotations &amp; Commercial Proposals
                    </h2>
                    <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full">
                      {open.length} open offer{open.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Commercial quotations currently under procurement review or bilateral revision.
                  </p>
                </div>
                <div className="text-xs text-right">
                  <span className="text-slate-500">Section Subtotal: </span>
                  <span className="font-jetbrains font-bold text-slate-900">
                    {formatRupees(sum(open))}
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-slate-50/75 border-b border-slate-100 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">
                    <tr>
                      <th className="py-3 px-5" scope="col">Quotation &amp; Title</th>
                      <th className="py-3 px-3" scope="col">Items / Deliverable Scope</th>
                      <th className="py-3 px-3 text-right" scope="col">Contract Value</th>
                      <th className="py-3 px-3" scope="col">Status</th>
                      <th className="py-3 px-3" scope="col">Last Updated</th>
                      <th className="py-3 px-5 text-right" scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {open.map((row) => (
                      <tr className="hover:bg-slate-50/60 transition-colors" key={row.id}>
                        <td className="py-4 px-5">
                          <div className="font-bold text-slate-900">{scopeTitle(row.productNames)}</div>
                          <div className="font-jetbrains text-[11px] text-indigo-600 mt-0.5">
                            {row.quoteNumber}
                          </div>
                        </td>
                        <td className="py-4 px-3 max-w-xs">
                          <div className="text-slate-800">{row.productNames.slice(0, 2).join(", ")}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {row.itemCount} deliverable{row.itemCount === 1 ? "" : "s"}
                            {row.awaitingSellerReview && " · Customer counter-proposal active"}
                          </div>
                        </td>
                        <td className="py-4 px-3 text-right font-jetbrains font-bold text-slate-900">
                          {formatRupees(row.totalAmount)}
                        </td>
                        <td className="py-4 px-3">
                          <CustomerStatusPill status={row.status} />
                        </td>
                        <td className="py-4 px-3 text-slate-500">
                          {new Date(row.lastUpdated).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                          })}
                        </td>
                        <td className="py-4 px-5 text-right">
                          <Link
                            className={
                              row.status === "Ready to Confirm"
                                ? "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
                                : "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 transition-colors"
                            }
                            href={`/my/quotations/${row.id}`}
                          >
                            {row.status === "Ready to Confirm" ? "Review Quotation" : "View Quotation"}
                            <span aria-hidden="true">→</span>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/60 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-slate-500">
                  {open.length} commercial proposal{open.length === 1 ? "" : "s"} awaiting final mutual
                  agreement
                </span>
                <span>
                  <span className="text-slate-500">Pending Total: </span>
                  <span className="font-jetbrains font-bold text-slate-900">{formatRupees(sum(open))}</span>
                </span>
              </div>
            </section>
          )}

          {settled.length > 0 && (
            <section className="bg-white border border-emerald-200/70 rounded-2xl overflow-hidden">
              <div className="p-5 sm:p-6 border-b border-emerald-100 flex flex-wrap items-start justify-between gap-3 bg-emerald-50/30">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-base font-bold text-slate-900">
                      Confirmed Agreements &amp; Executed Quotations
                    </h2>
                    <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                      {settled.length} locked agreement{settled.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Approved commercial proposals transitioning to procurement fulfilment and delivery.
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 bg-white border border-emerald-200 px-2.5 py-1 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Confirmed &amp; Locked
                </span>
              </div>

              <div className="p-5 sm:p-6 space-y-3">
                {settled.map((row) => (
                  <div
                    className="bg-slate-50/70 border border-slate-200/80 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    key={row.id}
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold text-xs shrink-0">
                        {initials(row.productNames)}
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 text-sm truncate">
                          {scopeTitle(row.productNames)}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          Reference:{" "}
                          <span className="font-jetbrains text-indigo-600">{row.quoteNumber}</span>
                          {" · "}
                          {row.itemCount} item{row.itemCount === 1 ? "" : "s"}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-right">
                        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                          Agreed Contract Value
                        </div>
                        <div className="font-jetbrains font-bold text-slate-900">
                          {formatRupees(row.totalAmount)}
                        </div>
                      </div>
                      <Link
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
                        href={`/my/quotations/${row.id}/confirmed`}
                      >
                        Inspect Terms
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <CustomerStatusBar />
      </CustomerWindowShell>

      <CustomerDock active="quotes" quotationId={open[0]?.id ?? settled[0]?.id ?? null} />
    </CustomerDesktop>
  );
}

function CustomerWindowShell({
  customerName,
  children,
}: {
  customerName: string;
  children: React.ReactNode;
}) {
  return (
    <main className="w-full max-w-6xl bg-white border border-slate-200/90 rounded-2xl shadow-2xl shadow-slate-300/40 overflow-hidden flex flex-col min-h-[820px] max-h-[calc(100vh-4rem)] my-auto">
      <CustomerHeader customerName={customerName} page="My Quotations" />
      {children}
    </main>
  );
}

function Figure({ label, value, tone = "text-slate-900" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-slate-500">{label}:</span>
      <span className={`font-jetbrains font-bold ${tone}`}>{value}</span>
    </div>
  );
}

/** A readable title from the products on the quote, since quotes have no name. */
function scopeTitle(productNames: string[]): string {
  if (productNames.length === 0) return "Commercial proposal";
  if (productNames.length === 1) return productNames[0];
  return `${productNames[0]} + ${productNames.length - 1} more`;
}

function initials(productNames: string[]): string {
  const source = productNames[0] ?? "DF";
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}
