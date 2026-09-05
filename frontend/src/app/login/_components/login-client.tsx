"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { CHROME_BAR, PAGE_SUBTITLE, PAGE_TITLE } from "@/components/design-tokens";
import { displayUtcClock } from "@/lib/display-clock";
import { ROUTES } from "@/lib/navigation";

export type AuthTab = "signin" | "signup" | "forgot" | "reset";

/** The subtitle under the brand mark, per tab. */
const SUBTITLES: Record<AuthTab, string> = {
  signin: "Enterprise Access Gateway",
  signup: "Provision new workspace in under 2 minutes",
  forgot: "Self-service cryptographic key recovery",
  reset: "Enforce cryptographic credential rotation",
};

const TAB_LABELS: [AuthTab, string][] = [
  ["signin", "Sign In"],
  ["signup", "Create Account"],
  ["forgot", "Forgot Password"],
  ["reset", "Reset"],
];

/**
 * The roles a workspace actually has.
 *
 * The mockup offered "Sales Director", "Revenue Ops Leader", "Finance
 * Controller" and "VP of Commercial Sales". None of those exist: `Role` is
 * SALES_REP, SALES_MANAGER, FINANCE_OPS, ADMIN, and the whole authorisation
 * matrix is keyed on it. A select that cannot produce a valid value is a
 * broken control, so the options are the real four.
 */
const ROLE_OPTIONS: [string, string][] = [
  ["SALES_REP", "Sales Rep"],
  ["SALES_MANAGER", "Sales Manager"],
  ["FINANCE_OPS", "Finance / Ops"],
  ["ADMIN", "Administrator"],
];

/**
 * The strength meter's thresholds.
 *
 * A hint, not the gate - the server re-checks every rule in `PASSWORD_RULES`.
 * It lives here rather than being imported because the backend module reaches
 * Prisma, which has no business in a browser bundle.
 */
function strengthOf(value: string): { width: string; label: string; tone: string } {
  if (!value) return { width: "0%", label: "Password strength", tone: "text-slate-400" };
  if (value.length < 8) return { width: "33%", label: "Weak", tone: "text-rose-600" };
  if (value.length < 12) return { width: "66%", label: "Medium", tone: "text-amber-600" };

  const complete =
    /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value) && /[^A-Za-z0-9]/.test(value);
  return complete
    ? { width: "100%", label: "Strong Enterprise Entropy", tone: "text-emerald-600" }
    : { width: "66%", label: "Medium", tone: "text-amber-600" };
}

function strengthBar(value: string): string {
  const { width } = strengthOf(value);
  if (width === "0%") return "bg-slate-300";
  if (width === "33%") return "bg-rose-500";
  if (width === "66%") return "bg-amber-500";
  return "bg-emerald-500";
}

const FIELD =
  "block w-full px-3 py-2.5 text-xs sm:text-sm border border-slate-200 rounded-xl bg-slate-50/50 hover:bg-white focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition-all placeholder:text-slate-400";
const FIELD_COMPACT = FIELD.replace("py-2.5", "py-2");
const LABEL = "block text-xs font-semibold text-slate-700 mb-1.5";
const SUBMIT =
  "w-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm hover:shadow transition-all font-medium py-3 rounded-xl text-xs sm:text-sm flex items-center justify-center gap-2 active:scale-[0.99] disabled:opacity-60";

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      {off ? (
        <path
          d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      ) : (
        <>
          <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
          <path
            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
        </>
      )}
    </svg>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  placeholder,
  compact = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  compact?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div>
      <label className={LABEL} htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          className={`${compact ? FIELD_COMPACT : FIELD} pr-10`}
          id={id}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required
          type={shown ? "text" : "password"}
          value={value}
        />
        <button
          aria-label="Toggle password visibility"
          className={`absolute inset-y-0 right-0 pr-3.5 flex items-center hover:text-slate-600 ${
            shown ? "text-indigo-600" : "text-slate-400"
          }`}
          onClick={() => setShown((s) => !s)}
          type="button"
        >
          <EyeIcon off={shown} />
        </button>
      </div>
    </div>
  );
}

export function LoginClient({
  callbackUrl,
  errorMessage,
  googleEnabled,
  googleSelfServiceDomains,
  initialTab,
  passwordRules,
  resetToken,
}: {
  callbackUrl: string;
  errorMessage: string | null;
  googleEnabled: boolean;
  googleSelfServiceDomains: string[];
  initialTab: AuthTab;
  passwordRules: string[];
  resetToken: string | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<AuthTab>(initialTab);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(errorMessage);
  const [toast, setToast] = useState<string | null>(null);
  const clock = useUtcClock();

  // Sign in
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);

  // Create account
  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupOrg, setSignupOrg] = useState("");
  const [signupRole, setSignupRole] = useState("SALES_REP");
  const [signupPassword, setSignupPassword] = useState("");
  const [terms, setTerms] = useState(false);

  // Recovery
  const [forgotEmail, setForgotEmail] = useState("");
  const [recovery, setRecovery] = useState<{ devLink: string | null } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const go = useCallback(
    (next: AuthTab) => {
      setTab(next);
      setProblem(null);
    },
    [],
  );

  async function handleSignIn(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);

    const result = await signIn("internal", {
      email,
      password,
      remember: String(remember),
      redirect: false,
    });

    setBusy(false);
    if (result?.error) {
      setProblem("That email and password do not match an active account.");
      return;
    }
    setToast("Signed in. Loading your workspace…");
    router.push(callbackUrl);
    router.refresh();
  }

  async function handleSignUp(event: React.FormEvent) {
    event.preventDefault();
    if (!terms) {
      setProblem("Please accept the Master Services Agreement to continue.");
      return;
    }
    setBusy(true);
    setProblem(null);

    const response = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: signupName,
        email: signupEmail,
        organization: signupOrg,
        role: signupRole,
        password: signupPassword,
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: string; details?: { message: string }[] }
        | null;
      // A password failure lists every broken rule, so show them all rather
      // than making the user discover them one at a time.
      const detail = body?.details?.map((d) => d.message).join(" · ");
      setProblem(detail || body?.error || "That account could not be created.");
      setBusy(false);
      return;
    }

    // Straight in, rather than asking them to retype what they just typed.
    const signedIn = await signIn("internal", {
      email: signupEmail,
      password: signupPassword,
      remember: "true",
      redirect: false,
    });
    setBusy(false);

    if (signedIn?.error) {
      setToast("Account created. Please sign in.");
      go("signin");
      setEmail(signupEmail);
      return;
    }
    setToast("Enterprise workspace provisioned.");
    router.push(callbackUrl);
    router.refresh();
  }

  async function handleForgot(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);

    const response = await fetch("/api/auth/password-reset/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: forgotEmail }),
    });
    const body = (await response.json().catch(() => null)) as { devLink?: string | null } | null;

    setBusy(false);
    setRecovery({ devLink: body?.devLink ?? null });
    setToast("Encrypted reset instructions sent to work email.");
  }

  async function handleReset(event: React.FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setProblem("The two passwords do not match.");
      return;
    }
    if (!resetToken) {
      setProblem("Open the recovery link from your email to reset your password.");
      return;
    }

    setBusy(true);
    setProblem(null);

    const response = await fetch("/api/auth/password-reset/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: resetToken, password: newPassword }),
    });
    const body = (await response.json().catch(() => null)) as
      | { error?: string; problems?: string[]; email?: string }
      | null;

    setBusy(false);

    if (!response.ok) {
      const problems = body?.problems?.length ? ` ${body.problems.join(" · ")}` : "";
      setProblem(`${body?.error ?? "That password could not be set."}${problems}`);
      return;
    }

    setToast("Password updated. Please sign in.");
    setEmail(body?.email ?? "");
    setNewPassword("");
    setConfirmPassword("");
    go("signin");
  }

  const canSelfProvisionViaGoogle = googleSelfServiceDomains.length > 0;

  return (
    <div className="bg-slate-100/90 text-slate-900 font-jakarta min-h-screen flex items-center justify-center p-6 lg:p-10 antialiased selection:bg-indigo-600 selection:text-white">
      {/* Toast */}
      <div
        className={`fixed top-6 right-6 z-50 transform transition-all duration-300 ease-out bg-slate-900/95 backdrop-blur-md text-white px-4 py-3 rounded-xl shadow-2xl border border-slate-700/80 flex items-center gap-3 text-xs sm:text-sm ${
          toast ? "translate-y-0 opacity-100" : "-translate-y-24 opacity-0"
        }`}
        role="status"
      >
        <div className="w-5 h-5 flex items-center justify-center text-emerald-400">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
          </svg>
        </div>
        <span className="font-medium">{toast ?? ""}</span>
      </div>

      {/* Window frame */}
      <div className="w-full max-w-5xl bg-white rounded-2xl shadow-2xl border border-slate-200/90 overflow-hidden flex flex-col min-h-[760px] transition-all">
        {/* Title bar. The DF chip and product name the mockup put here are
            omitted: the standing rule is that no page's top header carries the
            logo or the product name. The card below is the brand mark. */}
        <header className={CHROME_BAR}>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#ff5f57] border border-[#e0443e]/50" />
            <div className="w-3 h-3 rounded-full bg-[#febc2e] border border-[#d89e24]/50" />
            <div className="w-3 h-3 rounded-full bg-[#28c840] border border-[#1aab29]/50" />
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/70">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              SOC2 Type II · 256-bit TLS
            </span>
            <div className="h-3 w-px bg-slate-200 hidden md:block" />
            <span className="text-xs font-jetbrains text-slate-400 hidden md:inline">
              {clock ?? "UTC --:--:--"}
            </span>
            <a
              className="text-xs text-indigo-600 hover:text-indigo-700 font-semibold transition-colors"
              href="mailto:support@dealflow360.com"
            >
              Support
            </a>
          </div>
        </header>

        {/* Body */}
        <main className="flex-1 auth-grid bg-slate-50/50 flex flex-col items-center justify-center p-4 sm:p-8 lg:p-10 relative overflow-y-auto">
          <div className="absolute w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none -top-12" />

          <div className="w-full max-w-[520px] bg-white rounded-2xl shadow-card border border-slate-200/80 p-6 sm:p-8 relative z-10 my-auto">
            {/* Brand mark */}
            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center mb-3.5 relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl blur-sm opacity-25 group-hover:opacity-40 transition-opacity" />
                <div className="relative h-12 w-12 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-black text-xl shadow-md shadow-indigo-600/25 tracking-tight border border-indigo-500/40">
                  DF
                </div>
              </div>
              <div className="flex items-center justify-center gap-2 mb-1.5">
                <h1 className={PAGE_TITLE}>DealFlow360</h1>
                <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-100">
                  Enterprise CPQ &amp; Governance
                </span>
              </div>
              <p className={PAGE_SUBTITLE}>{SUBTITLES[tab]}</p>
            </div>

            {/* Tabs */}
            <nav
              aria-label="Authentication Flow"
              className="flex items-center bg-slate-100/90 p-1 rounded-xl mb-6 text-xs font-semibold text-slate-600 select-none border border-slate-200/60"
            >
              {TAB_LABELS.map(([key, label]) => (
                <button
                  className={`flex-1 py-1.5 px-2 rounded-lg text-center transition-all duration-150 ${
                    tab === key
                      ? "bg-white text-indigo-600 font-semibold"
                      : "font-medium text-slate-600 hover:text-slate-900"
                  }`}
                  key={key}
                  onClick={() => go(key)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </nav>

            {problem && (
              <p
                className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium"
                role="alert"
              >
                {problem}
              </p>
            )}

            {/* ---------------- SIGN IN ---------------- */}
            {tab === "signin" && (
              <div className="space-y-4">
                {/* One SSO button, not two. The mockup's second was "Okta /
                    SAML SSO", which nothing implements and which is removed
                    rather than left as a control that does nothing. */}
                <div className="grid grid-cols-1 gap-2.5">
                  <button
                    className="flex items-center justify-center gap-2 py-2.5 px-3 bg-white hover:bg-slate-50/80 border border-slate-200/90 rounded-xl text-xs font-semibold text-slate-700 hover:border-slate-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={busy || !googleEnabled}
                    onClick={() => signIn("google", { callbackUrl })}
                    type="button"
                  >
                    <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24">
                      <path
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        fill="#4285F4"
                      />
                      <path
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        fill="#34A853"
                      />
                      <path
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                        fill="#FBBC05"
                      />
                      <path
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                        fill="#EA4335"
                      />
                    </svg>
                    <span>Continue with Google Workspace</span>
                  </button>
                </div>

                <p className="text-[11px] text-slate-500 text-center leading-relaxed">
                  {!googleEnabled
                    ? "Google sign-in is not configured on this server yet."
                    : canSelfProvisionViaGoogle
                      ? `Google sign-in works for existing accounts, and for new ones at ${googleSelfServiceDomains
                          .map((d) => `@${d}`)
                          .join(", ")}.`
                      : "Google sign-in is for accounts that already exist here."}
                </p>

                <div className="relative flex items-center justify-center my-4">
                  <div className="border-t border-slate-200/90 w-full" />
                  <span className="bg-white px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400 absolute">
                    or continue with enterprise email
                  </span>
                </div>

                <form className="space-y-3.5" onSubmit={handleSignIn}>
                  <div>
                    <label className={LABEL} htmlFor="signin-email">
                      Work Email
                    </label>
                    <input
                      autoComplete="email"
                      className={FIELD}
                      id="signin-email"
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@company.com"
                      required
                      type="email"
                      value={email}
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-semibold text-slate-700" htmlFor="signin-password">
                        Password
                      </label>
                      <button
                        className="text-xs text-indigo-600 hover:text-indigo-700 font-semibold hover:underline"
                        onClick={() => go("forgot")}
                        type="button"
                      >
                        Forgot password?
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        autoComplete="current-password"
                        className={`${FIELD} pr-10`}
                        id="signin-password"
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        type="password"
                        value={password}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        checked={remember}
                        className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
                        onChange={(e) => setRemember(e.target.checked)}
                        type="checkbox"
                      />
                      <span className="text-xs text-slate-600 font-medium">
                        Remember this workstation for 30 days
                      </span>
                    </label>
                  </div>

                  <button className={SUBMIT} disabled={busy} type="submit">
                    <span>{busy ? "Signing in…" : "Sign In to Workspace"}</span>
                    {!busy && (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path d="M14 5l7 7m0 0l-7 7m7-7H3" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                      </svg>
                    )}
                  </button>
                </form>

                <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-center gap-2 text-[11px] text-slate-500 font-medium">
                  <svg className="w-3.5 h-3.5 text-indigo-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                    />
                  </svg>
                  <span>Customer? Use the link in your quotation email.</span>
                </div>
              </div>
            )}

            {/* ---------------- CREATE ACCOUNT ---------------- */}
            {tab === "signup" && (
              <div className="space-y-3.5">
                <form className="space-y-3" onSubmit={handleSignUp}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="signup-name">
                        Full Name
                      </label>
                      <input
                        className={FIELD_COMPACT}
                        id="signup-name"
                        onChange={(e) => setSignupName(e.target.value)}
                        placeholder="Vikram Patel"
                        required
                        type="text"
                        value={signupName}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="signup-email">
                        Work Email
                      </label>
                      <input
                        className={FIELD_COMPACT}
                        id="signup-email"
                        onChange={(e) => setSignupEmail(e.target.value)}
                        placeholder="v.patel@acme.com"
                        required
                        type="email"
                        value={signupEmail}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="signup-company">
                        Organization
                      </label>
                      <input
                        className={FIELD_COMPACT}
                        id="signup-company"
                        onChange={(e) => setSignupOrg(e.target.value)}
                        placeholder="Acme Global Inc"
                        type="text"
                        value={signupOrg}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="signup-role">
                        Workspace Role
                      </label>
                      <select
                        className={`${FIELD_COMPACT} font-medium text-slate-700`}
                        id="signup-role"
                        onChange={(e) => setSignupRole(e.target.value)}
                        value={signupRole}
                      >
                        {ROLE_OPTIONS.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <PasswordField
                      compact
                      id="signup-password"
                      label="Create Password"
                      onChange={setSignupPassword}
                      placeholder={`At least ${12} characters`}
                      value={signupPassword}
                    />
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${strengthBar(signupPassword)}`}
                          style={{ width: strengthOf(signupPassword).width }}
                        />
                      </div>
                      <span className={`text-[10px] font-semibold ${strengthOf(signupPassword).tone}`}>
                        {strengthOf(signupPassword).label}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-start gap-2 pt-1">
                    <input
                      checked={terms}
                      className="mt-0.5 w-3.5 h-3.5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
                      id="terms-agree"
                      onChange={(e) => setTerms(e.target.checked)}
                      required
                      type="checkbox"
                    />
                    <label className="text-[11px] text-slate-600 leading-tight" htmlFor="terms-agree">
                      I accept the Master Services Agreement, SOC2 compliance governance, and Privacy
                      Policy.
                    </label>
                  </div>

                  <button className={`${SUBMIT} mt-2`} disabled={busy} type="submit">
                    <span>{busy ? "Provisioning…" : "Create Enterprise Account →"}</span>
                  </button>
                </form>

                <div className="text-center text-xs text-slate-500 pt-1">
                  Already registered?
                  <button
                    className="text-indigo-600 hover:underline font-semibold ml-0.5"
                    onClick={() => go("signin")}
                    type="button"
                  >
                    Sign in to workspace
                  </button>
                </div>
              </div>
            )}

            {/* ---------------- FORGOT PASSWORD ---------------- */}
            {tab === "forgot" && (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-indigo-50/60 border border-indigo-100 text-center">
                  <div className="w-10 h-10 rounded-full bg-indigo-600/10 text-indigo-600 flex items-center justify-center mx-auto mb-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                      />
                    </svg>
                  </div>
                  <h2 className="text-sm font-bold text-slate-900">Reset your password</h2>
                  <p className="text-xs text-slate-600 mt-1 max-w-sm mx-auto">
                    Enter your work email address and we&apos;ll send you an encrypted recovery link.
                  </p>
                </div>

                <form className="space-y-3.5" onSubmit={handleForgot}>
                  <div>
                    <label className={LABEL} htmlFor="forgot-email">
                      Work Email
                    </label>
                    <input
                      className={FIELD}
                      id="forgot-email"
                      onChange={(e) => setForgotEmail(e.target.value)}
                      placeholder="name@company.com"
                      required
                      type="email"
                      value={forgotEmail}
                    />
                  </div>

                  {recovery && (
                    <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs space-y-2">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-emerald-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                        </svg>
                        <span>
                          If that address has an account, a recovery link is on its way. Valid for 15
                          minutes.
                        </span>
                      </div>
                      {/* No mail transport in this build. On a development
                          server the API hands the link back so the flow is
                          testable; in production this is never populated. */}
                      {recovery.devLink && (
                        <a
                          className="block font-jetbrains text-[11px] text-emerald-900 underline break-all"
                          href={recovery.devLink}
                        >
                          {recovery.devLink}
                        </a>
                      )}
                    </div>
                  )}

                  <button className={SUBMIT} disabled={busy} type="submit">
                    {busy ? "Sending…" : "Send Recovery Link"}
                  </button>
                  <button
                    className="w-full py-2.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors"
                    onClick={() => go("signin")}
                    type="button"
                  >
                    ← Return to Sign In
                  </button>
                </form>
              </div>
            )}

            {/* ---------------- RESET PASSWORD ---------------- */}
            {tab === "reset" && (
              <div className="space-y-4">
                {!resetToken && (
                  <p className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                    Open the recovery link from your email to reset your password. You can request
                    one from the Forgot Password tab.
                  </p>
                )}

                <form className="space-y-3.5" onSubmit={handleReset}>
                  <PasswordField
                    id="reset-new-password"
                    label="New Password"
                    onChange={setNewPassword}
                    placeholder="Enter new password"
                    value={newPassword}
                  />
                  <div>
                    <label className={LABEL} htmlFor="reset-confirm-password">
                      Confirm New Password
                    </label>
                    <input
                      className={FIELD}
                      id="reset-confirm-password"
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Repeat new password"
                      required
                      type="password"
                      value={confirmPassword}
                    />
                  </div>

                  {/* Rendered from the server's own PASSWORD_RULES, so the
                      checklist cannot promise a rule the server does not
                      enforce. Ticks turn green as each one passes. */}
                  <div className="p-3 bg-slate-50/90 border border-slate-200/80 rounded-xl space-y-1 text-[11px] text-slate-600">
                    <span className="font-semibold text-slate-800 block mb-1">
                      Corporate Security Policy Requirements:
                    </span>
                    {passwordRules.map((rule, index) => {
                      const met = ruleIsMet(index, newPassword);
                      return (
                        <div
                          className={`flex items-center gap-1.5 font-medium ${
                            met ? "text-emerald-600" : "text-slate-400"
                          }`}
                          key={rule}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                          </svg>
                          <span>{rule}</span>
                        </div>
                      );
                    })}
                  </div>

                  <button className={SUBMIT} disabled={busy || !resetToken} type="submit">
                    {busy ? "Updating…" : "Update Password & Sign In"}
                  </button>
                  <button
                    className="w-full py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors"
                    onClick={() => go("signin")}
                    type="button"
                  >
                    ← Back to Sign In
                  </button>
                </form>
              </div>
            )}
          </div>
        </main>

        {/* Status bar */}
        {/* Same height, palette and type as <StatusBar> on every app screen -
            written out rather than reused because this one ends in a link back
            to the marketing page instead of the version string. */}
        <footer className="h-8 shrink-0 border-t border-slate-200/80 px-4 bg-slate-50 flex items-center justify-between text-[11px] text-slate-500 select-none z-10">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span>Database: Connected (Asia-South-1)</span>
            <span className="text-slate-300">·</span>
            <span>Currency: INR (₹)</span>
          </div>
          <a className="font-jetbrains text-slate-600 hover:text-indigo-600" href={ROUTES.landing}>
            ← Back to dealflow360.com
          </a>
        </footer>
      </div>
    </div>
  );
}

/**
 * The ticking UTC readout.
 *
 * A clock is an external, mutable source rather than React state, so it is
 * subscribed to rather than copied into state by an effect - which is both the
 * idiomatic form and what keeps the render free of cascading updates.
 *
 * The server snapshot is null on purpose: the server has no second-hand to
 * agree with the browser about, so it renders a placeholder and the first
 * client render fills it in.
 */
function useUtcClock(): string | null {
  return useSyncExternalStore(
    (onChange) => {
      const id = setInterval(onChange, 1000);
      return () => clearInterval(id);
    },
    // Stable within a second, so React sees no change until the second turns.
    () => displayUtcClock(),
    () => null,
  );
}

/**
 * Whether rule `index` of PASSWORD_RULES passes.
 *
 * Positional, because the rules cross the server boundary as labels - a
 * function is not serialisable. The order is fixed in `password-policy.ts`,
 * and the server is what actually enforces them; this only tints the ticks.
 */
function ruleIsMet(index: number, value: string): boolean {
  if (!value) return false;
  switch (index) {
    case 0:
      return value.length >= 12;
    case 1:
      return /[a-z]/.test(value) && /[A-Z]/.test(value);
    case 2:
      return /[0-9]/.test(value) && /[^A-Za-z0-9]/.test(value);
    default:
      return false;
  }
}
