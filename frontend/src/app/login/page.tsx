import { redirect } from "next/navigation";
import {
  allowedDomains,
  GOOGLE_REJECTION_MESSAGE,
  PASSWORD_RULES,
  type GoogleRejection,
} from "@dealflow/backend";
import { getCurrentUser, googleConfigured } from "@/auth";
import { ROUTES } from "@/lib/navigation";
import { portalOnly } from "@/lib/surface";
import { LoginClient, type AuthTab } from "./_components/login-client";
import { PortalSignIn } from "./_components/portal-signin";

const TABS: AuthTab[] = ["signin", "signup", "forgot", "reset"];

/**
 * The identity screen: sign in, create account, forgot password, reset.
 *
 * Server component so three things the client must not compute are resolved
 * here: whether the visitor is already signed in, what a Google refusal
 * actually means, and what the password policy says. The last one matters -
 * the rules are rendered from `PASSWORD_RULES`, the same array the server
 * validates against, so the checklist on screen cannot drift from the rule
 * that is enforced.
 *
 * A reset link arrives as `?tab=reset&token=...`, which is why the tab is
 * addressable rather than purely local state.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    token?: string;
    error?: string;
    callbackUrl?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect(user.kind === "PORTAL" ? ROUTES.customerHome : ROUTES.home);

  const { tab, token, error, callbackUrl } = await searchParams;

  // The customer portal's own origin gets a customer's sign-in screen. A
  // password form, a sign-up tab and a Google button are three things a portal
  // visitor cannot use - they hold no password with us by design (D18).
  if (portalOnly()) {
    return <PortalSignIn reason={callbackUrl ? "expired" : "required"} />;
  }

  const rejection = error as GoogleRejection | undefined;
  const errorMessage =
    rejection && rejection in GOOGLE_REJECTION_MESSAGE
      ? GOOGLE_REJECTION_MESSAGE[rejection]
      : error
        ? "Sign-in could not be completed. Please try again."
        : null;

  // A token in the URL means the visitor followed a recovery link; open on
  // that tab whatever else the query says.
  const initialTab: AuthTab = token
    ? "reset"
    : TABS.find((t) => t === tab) ?? "signin";

  return (
    <LoginClient
      callbackUrl={callbackUrl ?? ROUTES.home}
      errorMessage={errorMessage}
      // Empty means nobody may self-provision through Google, which is the
      // default. The screen says so rather than offering a button that always
      // fails for a stranger.
      googleEnabled={googleConfigured()}
      googleSelfServiceDomains={allowedDomains()}
      initialTab={initialTab}
      passwordRules={PASSWORD_RULES.map((rule) => rule.label)}
      resetToken={token ?? null}
    />
  );
}
