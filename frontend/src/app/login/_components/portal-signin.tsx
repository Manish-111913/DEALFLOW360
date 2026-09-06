"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { signIn } from "next-auth/react";
import {
  CustomerDesktop,
  CustomerHeader,
  CustomerStatusBar,
} from "@/components/customer-shell";
import { ROUTES } from "@/lib/navigation";

/**
 * Sign-in, as it appears on the customer portal's own origin.
 *
 * A customer signs in with their own email and password, through the `portal`
 * provider - which refuses an INTERNAL row outright, so a staff password cannot
 * open this door even when it is correct. There is no sign-up tab and no Google
 * button: a portal account is created by the seller when the customer is set up
 * as an account, not by anyone who finds this page.
 *
 * The single-use link still works and still signs a customer straight in, so a
 * quotation email remains one click. It is now the shortcut rather than the only
 * way in, which is the whole change: a customer who has closed that email can
 * still reach their quotations.
 */
export function PortalSignIn({ reason }: { reason: "expired" | "required" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await signIn("portal", {
        email,
        password,
        remember: String(remember),
        redirect: false,
      });

      // Auth.js reports every credentials failure the same way on purpose, and
      // so does this: saying which half was wrong tells someone probing whether
      // an address exists.
      if (!result || result.error) {
        setError("That email and password do not match an account on this portal.");
        return;
      }

      router.push(ROUTES.customerHome);
      router.refresh();
    });
  }

  return (
    <CustomerDesktop>
      <main className="w-full max-w-6xl bg-white border border-slate-200/90 rounded-2xl shadow-2xl shadow-slate-300/40 overflow-hidden flex flex-col min-h-[820px] max-h-[calc(100vh-4rem)] my-auto">
        <CustomerHeader customerName="Customer Portal" page="Sign In" />

        <div className="flex-1 min-h-0 overflow-y-auto app-scroll flex items-center justify-center p-6 bg-[#fafbfe]">
          <section className="w-full max-w-md bg-white border border-slate-200/90 rounded-2xl p-8">
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-600 flex items-center justify-center mx-auto mb-4 ring-8 ring-indigo-50/50">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    d="M12 11c0-1.105.895-2 2-2h4a2 2 0 012 2v7a2 2 0 01-2 2H6a2 2 0 01-2-2v-7a2 2 0 012-2h4m0 0V7a2 2 0 114 0v2m-4 0h4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                  />
                </svg>
              </div>

              <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                {reason === "expired" ? "Your session has ended" : "Customer Portal"}
              </h1>
              <p className="text-sm text-slate-600 mt-2 leading-relaxed">
                {reason === "expired"
                  ? "For your security, portal sessions expire. Sign in again to continue."
                  : "Sign in to see your quotations, ask for a revision and confirm your order."}
              </p>
            </div>

            <form className="mt-6 space-y-4" onSubmit={submit}>
              <div>
                <label
                  className="block text-[11px] font-semibold text-slate-600 mb-1.5"
                  htmlFor="portal-email"
                >
                  Work email
                </label>
                <input
                  autoComplete="email"
                  className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400"
                  id="portal-email"
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                  type="email"
                  value={email}
                />
              </div>

              <div>
                <label
                  className="block text-[11px] font-semibold text-slate-600 mb-1.5"
                  htmlFor="portal-password"
                >
                  Password
                </label>
                <input
                  autoComplete="current-password"
                  className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400"
                  id="portal-password"
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  type="password"
                  value={password}
                />
              </div>

              <label
                className="flex items-center gap-2 text-xs text-slate-600 select-none"
                htmlFor="portal-remember"
              >
                <input
                  checked={remember}
                  className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/30"
                  id="portal-remember"
                  onChange={(e) => setRemember(e.target.checked)}
                  type="checkbox"
                />
                Remember this device
              </label>

              {error && (
                <p
                  className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2"
                  role="alert"
                >
                  {error}
                </p>
              )}

              <button
                className="w-full px-4 py-2.5 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors disabled:opacity-60"
                disabled={busy}
                type="submit"
              >
                {busy ? "Signing in…" : "Sign In to Portal"}
              </button>
            </form>

            <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                No account yet?
              </p>
              <p className="text-xs text-slate-600 leading-relaxed">
                Portal access is set up by your account manager. Ask them to invite you, or open the
                secure link in your quotation email - that signs you in without a password.
              </p>
            </div>

            {/* Staff who land here are on the wrong origin, and saying so is
                more useful than leaving them to guess. */}
            <p className="text-[11px] text-slate-400 mt-6 pt-4 border-t border-slate-100 leading-relaxed text-center">
              DealFlow360 staff: the internal workspace is a separate application.
            </p>
          </section>
        </div>

        <CustomerStatusBar />
      </main>
    </CustomerDesktop>
  );
}
