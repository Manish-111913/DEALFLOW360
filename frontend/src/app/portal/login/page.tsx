"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { AppShell } from "@/components/app-shell";
import { PAGE_SUBTITLE, PAGE_TITLE } from "@/components/design-tokens";
import { ROUTES } from "@/lib/navigation";

/**
 * Portal sign-in, by magic link (D18).
 *
 * Customers never get a password. Staff issue a single-use link, and this page
 * exchanges the token in it for a session through the "portal-link" provider -
 * which is a separate provider from the internal one precisely so a portal
 * credential can never authenticate a staff account.
 *
 * The token is consumed on use, so this page must submit it exactly once. React
 * runs effects twice in development Strict Mode, and a second submit would
 * present an already-consumed token and fail - hence the ref guard.
 */
export default function PortalLoginPage() {
  return (
    <Suspense fallback={null}>
      <PortalLogin />
    </Suspense>
  );
}

function PortalLogin() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;

    void (async () => {
      const result = await signIn("portal-link", { token, redirect: false });
      if (result?.error) {
        setError(
          "This link is no longer valid. Portal links are single-use and expire, so please ask your account manager for a fresh one.",
        );
        return;
      }
      router.push(ROUTES.negotiation);
      router.refresh();
    })();
  }, [token, router]);

  return (
    <AppShell className="screen-portal font-jakarta bg-[#f0f4f8] text-slate-800">
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="w-full max-w-sm bg-white rounded-xl border border-slate-200/90 shadow-2xs p-6 text-center">
          <h1 className={PAGE_TITLE}>Customer Portal</h1>

          {!token ? (
            <p className={PAGE_SUBTITLE}>
              This page is reached from the link in your quotation email. Open that link to view
              your quotation.
            </p>
          ) : error ? (
            <p className="text-xs text-rose-600 mt-2 leading-relaxed">{error}</p>
          ) : (
            <p className={PAGE_SUBTITLE}>Signing you in…</p>
          )}
        </div>
      </div>
    </AppShell>
  );
}
