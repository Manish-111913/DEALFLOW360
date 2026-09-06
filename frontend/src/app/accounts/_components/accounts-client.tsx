"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { AppShell, AppWindow, StatusBar, WindowScroll } from "@/components/app-shell";
import { AppDock } from "@/components/app-dock";
import { DealAssistant } from "@/components/deal-assistant";
import {
  CHROME_BAR,
  PAGE_SUBTITLE,
  PAGE_TITLE,
  SCROLL_PADDING,
  TABLE_HEAD,
} from "@/components/design-tokens";
import { ToastProvider, useToast, useToastState } from "@/components/toast";
import { NewAccountDialog, type AccountDraft } from "./new-account-dialog";
import { PortalAccessDialog } from "./portal-access-dialog";

/**
 * Screen 8 - Customer Accounts & Portal Access.
 *
 * The three things this screen does - create an account, add a portal contact,
 * issue a sign-in link - all existed in the backend from the start and none of
 * them had a caller. The only way to add a customer was to re-run the seed, and
 * the only way to let a buyer in was to run `npm run portal:link` in a terminal,
 * which is why the demo has exactly the accounts the seed writes.
 *
 * The frame is the shared one: window, chrome bar, title band, sub-header,
 * exactly one scroll region, footer, dock and assistant. Nothing here is drawn
 * differently from the other seven screens.
 */

export interface AccountRow {
  id: string;
  name: string;
  tier: string | null;
  status: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  accountOwnerId: string | null;
  accountOwnerName: string | null;
  mine: boolean;
  quotationCount: number;
  sharedCount: number;
  portalUsers: { id: string; name: string; email: string; active: boolean }[];
  hasLiveLink: boolean;
  canGrantAccess: boolean;
}

export interface AccountsData {
  rows: AccountRow[];
  /** Reps and managers this caller may hand an account to. Empty for a rep. */
  owners: { id: string; name: string; role: string }[];
  canCreate: boolean;
}

const TIER_PILL: Record<string, string> = {
  GOLD: "bg-amber-50 text-amber-700 border-amber-200",
  SILVER: "bg-slate-100 text-slate-700 border-slate-200",
  BRONZE: "bg-orange-50 text-orange-700 border-orange-200",
};

type Filter = "all" | "mine" | "portal" | "no-portal";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All Accounts" },
  { key: "mine", label: "My Accounts" },
  { key: "portal", label: "Portal Enabled" },
  { key: "no-portal", label: "No Portal Access" },
];

export function AccountsClient({ data }: { data: AccountsData }) {
  return (
    <ToastProvider durationMs={3200}>
      <Accounts data={data} />
    </ToastProvider>
  );
}

function Accounts({ data }: { data: AccountsData }) {
  const router = useRouter();
  const showToast = useToast();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  // Held by id, so a router refresh after adding a contact reopens the dialog
  // on the updated account rather than the copy it was opened with.
  const [accessId, setAccessId] = useState<string | null>(null);
  const [issuedLink, setIssuedLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const accessAccount = data.rows.find((row) => row.id === accessId) ?? null;

  const counts = useMemo(() => {
    const withPortal = data.rows.filter((row) => row.portalUsers.length > 0).length;
    return {
      total: data.rows.length,
      mine: data.rows.filter((row) => row.mine).length,
      withPortal,
      shared: data.rows.reduce((sum, row) => sum + row.sharedCount, 0),
    };
  }, [data.rows]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return data.rows.filter((row) => {
      if (filter === "mine" && !row.mine) return false;
      if (filter === "portal" && row.portalUsers.length === 0) return false;
      if (filter === "no-portal" && row.portalUsers.length > 0) return false;
      if (!term) return true;
      return (
        row.name.toLowerCase().includes(term) ||
        (row.contactName ?? "").toLowerCase().includes(term) ||
        (row.accountOwnerName ?? "").toLowerCase().includes(term)
      );
    });
  }, [data.rows, filter, search]);

  function create(draft: AccountDraft) {
    startTransition(async () => {
      const response = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          tier: draft.tier,
          contactName: draft.contactName,
          email: draft.email,
          phone: draft.phone,
          accountOwnerId: draft.accountOwnerId || undefined,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setProblem(body.error ?? "The account was not created");
        return;
      }
      setCreating(false);
      setProblem(null);
      showToast(`${body.name} created. It can be quoted straight away.`);
      router.refresh();
    });
  }

  function addContact(customerId: string, email: string, name: string, password: string) {
    startTransition(async () => {
      const response = await fetch(`/api/accounts/${customerId}/portal-users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, password: password || undefined }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setProblem(body.error ?? "The contact was not added");
        return;
      }
      setProblem(null);
      showToast(`${body.email} may now sign in to the portal.`);
      router.refresh();
    });
  }

  function issueLink(customerId: string) {
    startTransition(async () => {
      const response = await fetch(`/api/accounts/${customerId}/portal-link`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setProblem(body.error ?? "The link was not issued");
        return;
      }
      setProblem(null);
      // Kept in state rather than re-fetched, because the raw token exists only
      // in this response - the database holds nothing but its hash.
      setIssuedLink({ url: body.url, expiresAt: body.expiresAt });
      showToast(`Sign-in link issued for ${body.customerName}.`);
      router.refresh();
    });
  }

  function closeAccess() {
    setAccessId(null);
    setIssuedLink(null);
    setProblem(null);
  }

  return (
    <AppShell className="screen-accounts font-jakarta bg-[#f0f4f8] text-slate-800 selection:bg-indigo-100 selection:text-indigo-800">
      <AppWindow>
        <header className={CHROME_BAR}>
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-1.5">
              <span className="w-3 h-3 rounded-full bg-[#ff5f56] inline-block shadow-sm" />
              <span className="w-3 h-3 rounded-full bg-[#ffbd2e] inline-block shadow-sm" />
              <span className="w-3 h-3 rounded-full bg-[#27c93f] inline-block shadow-sm" />
            </div>
            <div className="h-4 w-px bg-slate-300" />
            <div className="text-xs font-medium text-slate-600">
              Sales Operations &amp; Account Administration
            </div>
          </div>
        </header>

        <section className="shrink-0 border-b border-slate-200/80 px-6 py-3.5 bg-white">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <div className="flex items-center space-x-2.5">
                <h1 className={PAGE_TITLE}>Customer Accounts &amp; Portal Access</h1>
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                  {counts.total} account{counts.total === 1 ? "" : "s"}
                </span>
              </div>
              <p className={PAGE_SUBTITLE}>
                Create accounts, provision portal contacts, and issue the single-use links buyers
                sign in with.
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <input
                className="w-56 text-xs rounded-lg border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/20 py-1.5 px-3"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search accounts, contacts, owners"
                type="search"
                value={search}
              />
              {/* Finance and Operations do not open accounts, so they are not
                  offered a button the create endpoint would refuse. */}
              {data.canCreate && (
                <button
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-colors"
                  onClick={() => {
                    setProblem(null);
                    setCreating(true);
                  }}
                  type="button"
                >
                  New Account
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="shrink-0 border-b border-slate-200/80 px-6 py-2.5 bg-slate-50/70">
          <div className="flex flex-wrap items-center justify-between gap-4 text-xs">
            <div className="flex flex-wrap items-center gap-6 divide-x divide-slate-200">
              <Metric label="Accounts" value={String(counts.total)} strong />
              <Metric label="Mine" pad value={String(counts.mine)} />
              <Metric label="Portal Enabled" indigo pad value={String(counts.withPortal)} />
              <Metric label="Quotes Shared" pad value={String(counts.shared)} />
            </div>

            <div className="flex items-center bg-white border border-slate-200 p-0.5 rounded-lg text-xs">
              {FILTERS.map((option) => (
                <button
                  className={
                    "px-2.5 py-1 rounded font-medium transition-colors " +
                    (filter === option.key
                      ? "bg-indigo-50 text-indigo-700 shadow-2xs"
                      : "text-slate-600 hover:text-slate-900")
                  }
                  key={option.key}
                  onClick={() => setFilter(option.key)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <WindowScroll className={SCROLL_PADDING}>
          <section className="bg-white rounded-xl border border-slate-200/90 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className={TABLE_HEAD}>
                  <tr>
                    <th className="py-3 px-5">Account</th>
                    <th className="py-3 px-4">Tier</th>
                    <th className="py-3 px-4">Account Owner</th>
                    <th className="py-3 px-4">Deals</th>
                    <th className="py-3 px-4">Portal Access</th>
                    <th className="py-3 px-5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                  {visible.map((row) => (
                    <tr className="hover:bg-slate-50/70 transition-colors" key={row.id}>
                      <td className="py-3.5 px-5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900">{row.name}</span>
                          {row.status !== "ACTIVE" && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-slate-600 bg-slate-200/70">
                              {row.status}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {row.contactName ?? "No named contact"}
                          {row.email ? ` · ${row.email}` : ""}
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        {row.tier ? (
                          <span
                            className={
                              "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border " +
                              (TIER_PILL[row.tier] ?? "bg-slate-100 text-slate-600 border-slate-200")
                            }
                          >
                            {row.tier}
                          </span>
                        ) : (
                          // Worth calling out rather than showing a dash: this
                          // account cannot be quoted at all until it has one.
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border bg-rose-50 text-rose-700 border-rose-200">
                            No tier
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        <span className={row.mine ? "font-bold text-indigo-700" : "text-slate-700"}>
                          {row.accountOwnerName ?? "Unassigned"}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 font-jetbrains text-slate-600">
                        {row.quotationCount}
                        <span className="text-slate-400"> / {row.sharedCount} shared</span>
                      </td>

                      <td className="py-3.5 px-4">
                        {row.portalUsers.length === 0 ? (
                          <span className="text-slate-400">None</span>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-slate-800">
                              {row.portalUsers.length} contact
                              {row.portalUsers.length === 1 ? "" : "s"}
                            </span>
                            {row.hasLiveLink && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-emerald-700 bg-emerald-100/60">
                                Link live
                              </span>
                            )}
                          </div>
                        )}
                      </td>

                      <td className="py-3.5 px-5 text-right">
                        {row.canGrantAccess ? (
                          <button
                            className="px-2.5 py-1 rounded font-medium text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                            onClick={() => {
                              setProblem(null);
                              setIssuedLink(null);
                              setAccessId(row.id);
                            }}
                            type="button"
                          >
                            Portal Access
                          </button>
                        ) : (
                          // Provisioning access to an account is the owner's,
                          // their manager's or an admin's call - not everyone's.
                          <span className="text-[11px] text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {visible.length === 0 && (
              <div className="p-8 text-center">
                <p className="text-sm font-bold text-slate-900">No accounts match</p>
                <p className="text-xs text-slate-500 mt-1">
                  {data.rows.length === 0
                    ? "No customer accounts exist yet."
                    : "Try a different filter or search term."}
                </p>
              </div>
            )}
          </section>
        </WindowScroll>

        <StatusBar />
      </AppWindow>

      <AppDock />
      <DealAssistant quotationId={null} screen="accounts" subject={null} />
      <AccountsToast />

      {creating && (
        <NewAccountDialog
          busy={busy}
          onClose={() => setCreating(false)}
          onCreate={create}
          owners={data.owners}
          problem={problem}
        />
      )}

      {accessAccount && (
        <PortalAccessDialog
          account={accessAccount}
          busy={busy}
          issuedLink={issuedLink}
          onAddContact={(email, name, password) => addContact(accessAccount.id, email, name, password)}
          onClose={closeAccess}
          onIssueLink={() => issueLink(accessAccount.id)}
          problem={problem}
        />
      )}
    </AppShell>
  );
}

function Metric({
  label,
  value,
  strong,
  indigo,
  pad,
}: {
  label: string;
  value: string;
  strong?: boolean;
  indigo?: boolean;
  pad?: boolean;
}) {
  return (
    <div className={"flex items-center space-x-2 " + (pad ? "pl-6" : "")}>
      <span className="text-slate-500">{label}:</span>
      <span
        className={
          strong
            ? "font-bold text-slate-900 text-sm"
            : indigo
              ? "font-semibold text-indigo-700"
              : "font-semibold text-slate-800"
        }
      >
        {value}
      </span>
    </div>
  );
}

function AccountsToast() {
  const { message, visible } = useToastState();
  return (
    <div
      className={
        "fixed bottom-20 right-6 z-50 bg-slate-900 text-white text-xs px-4 py-2.5 rounded-xl shadow-2xl transition-all duration-200 " +
        (visible ? "opacity-100" : "opacity-0 pointer-events-none translate-y-4")
      }
    >
      {message}
    </div>
  );
}
