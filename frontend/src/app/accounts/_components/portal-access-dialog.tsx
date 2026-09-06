"use client";

import { useState } from "react";
import type { AccountRow } from "./accounts-client";

/**
 * Portal access for one account: who may sign in, and the link that lets them.
 *
 * The two are deliberately separate acts. A portal contact is a durable
 * identity with no password - they authenticate by magic link - and the link is
 * a single-use credential handed to them. Issuing a link for an account with no
 * contact would produce something that resolves to a customer and then finds
 * nobody to sign in as, so the service refuses it and this dialog says why
 * before you try.
 *
 * The raw token is shown exactly once. Only its hash is stored, so a link that
 * is closed without being copied cannot be recovered - a new one has to be
 * issued. That is the property that makes a leaked database row useless.
 */

const FIELD_LABEL = "block text-xs font-semibold text-slate-700 mb-1";
const FIELD =
  "w-full text-sm font-medium rounded-lg border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/20 py-2 px-3";

export function PortalAccessDialog({
  account,
  issuedLink,
  busy,
  problem,
  onAddContact,
  onIssueLink,
  onClose,
}: {
  account: AccountRow;
  /** Set once a link has been minted in this session. Never re-readable. */
  issuedLink: { url: string; expiresAt: string } | null;
  busy: boolean;
  problem: string | null;
  onAddContact: (email: string, name: string, password: string) => void;
  onIssueLink: () => void;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  // Optional: a contact given one signs in at the portal, a contact given none
  // is sent a single-use link instead. Both doors are real.
  const [password, setPassword] = useState("");
  const [local, setLocal] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function addContact() {
    if (!name.trim()) {
      setLocal("A portal contact needs a name.");
      return;
    }
    if (!email.includes("@")) {
      setLocal("That does not look like an email address.");
      return;
    }
    onAddContact(email.trim(), name.trim(), password);
    setEmail("");
    setName("");
    setPassword("");
  }

  async function copy() {
    if (!issuedLink) return;
    try {
      await navigator.clipboard.writeText(issuedLink.url);
      setCopied(true);
    } catch {
      // Clipboard access is refused in some browsers and over plain HTTP. The
      // link is on screen and selectable, so this is a convenience failing.
      setLocal("Could not reach the clipboard — select the link and copy it.");
    }
  }

  const message = local ?? problem;

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 shrink-0">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Portal Access</h3>
            <p className="text-xs text-slate-500">{account.name}</p>
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

        <div className="p-6 space-y-5 overflow-y-auto app-scroll">
          <div className="space-y-2">
            <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block">
              Portal contacts ({account.portalUsers.length})
            </span>
            {account.portalUsers.length === 0 ? (
              <p className="text-xs text-slate-500">
                Nobody can sign in for this account yet. Add a contact below.
              </p>
            ) : (
              <div className="space-y-1.5">
                {account.portalUsers.map((contact) => (
                  <div
                    className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200/80"
                    key={contact.id}
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900 truncate">{contact.name}</p>
                      <p className="text-[11px] text-slate-500 truncate">{contact.email}</p>
                    </div>
                    <span
                      className={
                        "text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 " +
                        (contact.active
                          ? "text-emerald-700 bg-emerald-100/60"
                          : "text-slate-600 bg-slate-200/70")
                      }
                    >
                      {contact.active ? "Active" : "Disabled"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pt-1 border-t border-slate-100 space-y-3">
            <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block pt-3">
              Add a contact
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={FIELD_LABEL} htmlFor="contact-name">
                  Name
                </label>
                <input
                  className={FIELD}
                  id="contact-name"
                  onChange={(event) => {
                    setName(event.target.value);
                    setLocal(null);
                  }}
                  placeholder="Priya Nair"
                  type="text"
                  value={name}
                />
              </div>
              <div>
                <label className={FIELD_LABEL} htmlFor="contact-email">
                  Email
                </label>
                <input
                  className={FIELD}
                  id="contact-email"
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setLocal(null);
                  }}
                  placeholder="buyer@customer.test"
                  type="email"
                  value={email}
                />
              </div>
              <div>
                <label className={FIELD_LABEL} htmlFor="contact-password">
                  Password <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <input
                  autoComplete="new-password"
                  className={FIELD}
                  id="contact-password"
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setLocal(null);
                  }}
                  placeholder="leave blank to send a link instead"
                  type="password"
                  value={password}
                />
              </div>
            </div>
            <button
              className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg disabled:opacity-60"
              disabled={busy}
              onClick={addContact}
              type="button"
            >
              {busy ? "Adding…" : "Add Contact"}
            </button>
          </div>

          <div className="pt-1 border-t border-slate-100">
            <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block pt-3 mb-2">
              Sign-in link
            </span>

            {issuedLink ? (
              <div className="p-3 rounded-lg bg-emerald-50/70 border border-emerald-200 space-y-2">
                <p className="text-[11px] text-emerald-900 font-medium">
                  Single-use. Shown once — it cannot be read back.
                </p>
                <p className="text-[11px] font-jetbrains text-slate-700 break-all bg-white/80 rounded-md p-2 border border-emerald-200/70 select-all">
                  {issuedLink.url}
                </p>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-emerald-800">
                    Expires {new Date(issuedLink.expiresAt).toLocaleString("en-GB")}
                  </span>
                  <button
                    className="px-2.5 py-1 text-[11px] font-semibold text-emerald-800 bg-white hover:bg-emerald-50 border border-emerald-300 rounded-lg"
                    onClick={copy}
                    type="button"
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-[11px] text-slate-500 mb-2">
                  {account.hasLiveLink
                    ? "An unused link is already outstanding for this account. Issuing another does not revoke it."
                    : "Mints a fresh link for this account's contacts. It works once."}
                </p>
                <button
                  className="px-4 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm disabled:opacity-60"
                  disabled={busy || account.portalUsers.length === 0}
                  onClick={onIssueLink}
                  type="button"
                >
                  {busy ? "Issuing…" : "Issue Sign-in Link"}
                </button>
              </>
            )}
          </div>

          {message && <p className="text-[11px] text-rose-600 font-medium">{message}</p>}
        </div>

        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2.5 shrink-0">
          <button
            className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-white border border-slate-300 rounded-lg"
            onClick={onClose}
            type="button"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
