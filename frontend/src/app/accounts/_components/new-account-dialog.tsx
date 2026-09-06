"use client";

import { useState } from "react";

/**
 * Create a customer account.
 *
 * The tier is a required choice rather than a nullable field with a blank
 * option, even though the column allows null. Discount ceilings are resolved
 * from the tier, so a tier-less customer skips every ceiling check silently and
 * `assertCustomerCanBeQuoted` refuses to quote it - a form that let you save one
 * would only ever produce an account nobody can sell to.
 *
 * Chrome, field styling and button weights are the Manual Warehouse Override
 * dialog's, which is the reference dialog across the application.
 */

export interface AccountDraft {
  name: string;
  tier: string;
  contactName: string;
  email: string;
  phone: string;
  accountOwnerId: string;
}

const TIERS = [
  { value: "BRONZE", label: "Bronze", note: "Standard ceilings" },
  { value: "SILVER", label: "Silver", note: "Mid-tier ceilings" },
  { value: "GOLD", label: "Gold", note: "Highest ceilings" },
];

const FIELD_LABEL = "block text-xs font-semibold text-slate-700 mb-1";
const FIELD =
  "w-full text-sm font-medium rounded-lg border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/20 py-2 px-3";

export function NewAccountDialog({
  owners,
  busy,
  problem,
  onCreate,
  onClose,
}: {
  /** Empty for a rep, who owns whatever they create. */
  owners: { id: string; name: string; role: string }[];
  busy: boolean;
  /** A message from the server - a duplicate name, usually. */
  problem: string | null;
  onCreate: (draft: AccountDraft) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<AccountDraft>({
    name: "",
    tier: "SILVER",
    contactName: "",
    email: "",
    phone: "",
    accountOwnerId: "",
  });
  const [local, setLocal] = useState<string | null>(null);

  function set<K extends keyof AccountDraft>(key: K, value: AccountDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setLocal(null);
  }

  function create() {
    if (!draft.name.trim()) {
      setLocal("An account needs a name.");
      return;
    }
    if (draft.email.trim() && !draft.email.includes("@")) {
      setLocal("That does not look like an email address.");
      return;
    }
    onCreate(draft);
  }

  const message = local ?? problem;

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 shrink-0">
          <div>
            <h3 className="text-sm font-bold text-slate-900">New Customer Account</h3>
            <p className="text-xs text-slate-500">
              The account a quotation is raised against
            </p>
          </div>
          <button
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
            onClick={onClose}
            type="button"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto app-scroll">
          <div>
            <label className={FIELD_LABEL} htmlFor="account-name">
              Account name
            </label>
            <input
              autoFocus
              className={FIELD}
              id="account-name"
              onChange={(event) => set("name", event.target.value)}
              placeholder="Northwind Manufacturing"
              type="text"
              value={draft.name}
            />
          </div>

          <div>
            <span className={FIELD_LABEL}>Tier</span>
            {/* Not a dropdown with a blank option: the tier decides which
                discount ceiling every future quote is checked against. */}
            <div className="grid grid-cols-3 gap-2">
              {TIERS.map((tier) => (
                <label
                  className={
                    "p-2.5 rounded-lg border cursor-pointer text-center transition-colors " +
                    (draft.tier === tier.value
                      ? "border-indigo-300 bg-indigo-50/60"
                      : "border-slate-200 hover:bg-slate-50")
                  }
                  key={tier.value}
                >
                  <input
                    checked={draft.tier === tier.value}
                    className="sr-only"
                    name="account-tier"
                    onChange={() => set("tier", tier.value)}
                    type="radio"
                    value={tier.value}
                  />
                  <span className="block text-xs font-bold text-slate-900">{tier.label}</span>
                  <span className="block text-[10px] text-slate-500 mt-0.5">{tier.note}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={FIELD_LABEL} htmlFor="account-contact">
                Primary contact
              </label>
              <input
                className={FIELD}
                id="account-contact"
                onChange={(event) => set("contactName", event.target.value)}
                placeholder="Optional"
                type="text"
                value={draft.contactName}
              />
            </div>
            <div>
              <label className={FIELD_LABEL} htmlFor="account-phone">
                Phone
              </label>
              <input
                className={FIELD}
                id="account-phone"
                onChange={(event) => set("phone", event.target.value)}
                placeholder="Optional"
                type="tel"
                value={draft.phone}
              />
            </div>
          </div>

          <div>
            <label className={FIELD_LABEL} htmlFor="account-email">
              Email
            </label>
            <input
              className={FIELD}
              id="account-email"
              onChange={(event) => set("email", event.target.value)}
              placeholder="Optional — the account's own address, not a portal login"
              type="email"
              value={draft.email}
            />
          </div>

          {owners.length > 0 && (
            <div>
              <label className={FIELD_LABEL} htmlFor="account-owner">
                Account owner
              </label>
              <select
                className={FIELD}
                id="account-owner"
                onChange={(event) => set("accountOwnerId", event.target.value)}
                value={draft.accountOwnerId}
              >
                <option value="">Me</option>
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name} · {owner.role === "SALES_MANAGER" ? "Manager" : "Rep"}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500 mt-1">
                The owner&rsquo;s deals are what their book shows, so this decides who sees the
                account&rsquo;s quotations.
              </p>
            </div>
          )}

          {message && <p className="text-[11px] text-rose-600 font-medium">{message}</p>}
        </div>

        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2.5 shrink-0">
          <button
            className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-white border border-slate-300 rounded-lg"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="px-4 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm disabled:opacity-60"
            disabled={busy}
            onClick={create}
            type="button"
          >
            {busy ? "Creating…" : "Create Account"}
          </button>
        </div>
      </div>
    </div>
  );
}
