import { redirect } from "next/navigation";
import NextAuth from "next-auth";
import { assertServesInternal, cookiePrefix } from "@/lib/surface";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import {
  consumePortalLink,
  currentBusinessTime,
  prisma,
  resolveGoogleSignIn,
  verifyPassword,
  type AuthzUser,
  type Role,
  type UserKind,
} from "@dealflow/backend";

/**
 * Three providers, two surfaces.
 *
 * Internal users sign in with email and password, or with Google Workspace.
 * Portal users present a single-use magic link (D18). They are separate
 * providers rather than one with a branch, so a portal credential can never
 * authenticate an internal account by accident.
 *
 * Google runs without an Auth.js adapter on purpose. Our User model requires
 * `kind`, `name`, `createdAt` and `updatedAt`, none of which an adapter's
 * generic createUser knows how to fill - so `resolveGoogleSignIn` owns that
 * decision instead, including whether a stranger may self-provision at all.
 *
 * Session strategy is JWT because Auth.js Credentials providers do not support
 * database sessions. The claims below are what `getCurrentUser()` rebuilds an
 * AuthzUser from, so scoping and capability checks never re-query on the hot
 * path.
 *
 * Next 16 note: the `proxy` convention (formerly `middleware`) runs on the
 * Node.js runtime and cannot be configured to edge, so there is no need for the
 * split "edge-safe config" pattern Auth.js otherwise requires — this full
 * config, Prisma included, is usable everywhere.
 */
/**
 * Shared options for this surface's cookies.
 *
 * `secure: false` because both surfaces run on plain http in development; a
 * deployment behind TLS should set this from the environment.
 */
const SESSION_COOKIE = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  secure: false,
} as const;

/** Whether Google sign-in can work at all. Both halves or neither. */
export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** 30 days, matching what the sign-in screen offers to remember. */
const REMEMBERED_DAYS = 30;
/** A workstation the user did not ask us to remember. */
const UNREMEMBERED_HOURS = 12;

export const { handlers, auth, signIn, signOut } = NextAuth({
  // The cookie lives for the longer of the two options; which one actually
  // applies is decided per session below, because Auth.js takes one static
  // maxAge and the checkbox has to mean something.
  session: { strategy: "jwt", maxAge: REMEMBERED_DAYS * 24 * 60 * 60 },

  /**
   * One cookie set per surface.
   *
   * Without this the internal workspace and the customer portal share
   * `authjs.session-token`, because cookies are scoped by host and ignore the
   * port - so signing in as a customer on :3000 would silently end the sales
   * manager's session on :3001. Naming them apart lets both be open at once,
   * which is exactly how the two-sided demo is meant to be watched.
   */
  cookies: {
    sessionToken: { name: `${cookiePrefix()}.session-token`, options: SESSION_COOKIE },
    callbackUrl: { name: `${cookiePrefix()}.callback-url`, options: { sameSite: "lax", path: "/", secure: false } },
    csrfToken: { name: `${cookiePrefix()}.csrf-token`, options: SESSION_COOKIE },
    pkceCodeVerifier: { name: `${cookiePrefix()}.pkce.code_verifier`, options: { ...SESSION_COOKIE, maxAge: 900 } },
    state: { name: `${cookiePrefix()}.state`, options: { ...SESSION_COOKIE, maxAge: 900 } },
    nonce: { name: `${cookiePrefix()}.nonce`, options: SESSION_COOKIE },
  },
  trustHost: true,
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      id: "internal",
      name: "Internal",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        remember: { label: "Remember this workstation", type: "text" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").trim().toLowerCase();
        const password = String(credentials?.password ?? "");
        const remember = String(credentials?.remember ?? "") === "true";
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        // Internal login never authenticates a portal identity, even with the
        // correct password.
        if (!user || !user.active || user.kind !== "INTERNAL" || !user.passwordHash) {
          return null;
        }
        if (!(await verifyPassword(password, user.passwordHash))) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          kind: user.kind,
          role: user.role,
          customerId: null,
          salesTeamId: user.salesTeamId,
          remember,
        };
      },
    }),

    // Registered only once credentials exist. Auth.js rejects a provider with
    // no client id at the moment it is used, so an unconfigured deployment
    // would offer a button that throws; instead the provider is absent and the
    // screen knows not to draw it (`googleEnabled`).
    ...(googleConfigured()
      ? [
          Google({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            // Only what is needed to identify the person. No Workspace
            // directory scopes: we authenticate them, we do not read their
            // organisation.
            authorization: {
              params: { scope: "openid email profile", prompt: "select_account" },
            },
            // Linking is done by `resolveGoogleSignIn`, which checks the
            // address is verified and the account is internal and active
            // first. Auth.js's own linking does none of that.
            allowDangerousEmailAccountLinking: false,
          }),
        ]
      : []),

    /**
     * The customer's own email and password.
     *
     * Separate from the `internal` provider above rather than one provider with
     * a branch, for the same reason the link provider is: each one refuses the
     * other's kind outright, so a customer credential can never authenticate a
     * staff account even if the two rows shared an address.
     */
    Credentials({
      id: "portal",
      name: "Customer portal",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        remember: { label: "Remember this device", type: "text" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").trim().toLowerCase();
        const password = String(credentials?.password ?? "");
        const remember = String(credentials?.remember ?? "") === "true";
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        // The mirror of the internal check: a staff password is refused here
        // even when it is correct.
        if (!user || !user.active || user.kind !== "PORTAL" || !user.passwordHash) {
          return null;
        }
        if (!(await verifyPassword(password, user.passwordHash))) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          kind: user.kind,
          role: null,
          customerId: user.customerId,
          salesTeamId: null,
          remember,
        };
      },
    }),

    Credentials({
      id: "portal-link",
      name: "Portal magic link",
      credentials: { token: { label: "Token", type: "text" } },
      async authorize(credentials) {
        const token = String(credentials?.token ?? "");
        if (!token) return null;

        const result = await consumePortalLink(token);
        if (!result.ok) return null;

        const user = await prisma.user.findUnique({ where: { id: result.userId } });
        if (!user || !user.active || user.kind !== "PORTAL") return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          kind: user.kind,
          role: null,
          customerId: user.customerId,
          salesTeamId: null,
        };
      },
    }),
  ],

  callbacks: {
    /**
     * The gate for Google. Credentials providers have already decided by the
     * time they get here, so they simply pass.
     *
     * A refusal returns a URL rather than false: Auth.js renders its own
     * generic error page for `false`, and the reason a sign-in was refused is
     * exactly what the person needs to read.
     */
    async signIn({ user, account, profile }) {
      if (account?.provider !== "google") return true;

      const result = await resolveGoogleSignIn({
        email: profile?.email ?? user.email,
        emailVerified: Boolean((profile as { email_verified?: boolean } | undefined)?.email_verified),
        name: profile?.name ?? user.name,
        providerAccountId: account.providerAccountId,
      });

      return result.ok ? true : `/login?error=${result.reason}`;
    },

    async jwt({ token, user, account }) {
      // Google: `user` is Google's profile, not ours, so our claims are read
      // back from the row `resolveGoogleSignIn` just guaranteed exists.
      if (account?.provider === "google") {
        const email = (user?.email ?? token.email)?.trim().toLowerCase();
        const dbUser = email ? await prisma.user.findUnique({ where: { email } }) : null;
        if (dbUser) {
          token.uid = dbUser.id;
          token.kind = dbUser.kind;
          token.role = dbUser.role;
          token.customerId = null;
          token.salesTeamId = dbUser.salesTeamId;
          // Signing in through an identity provider is a deliberate act at a
          // machine they chose; treat it as remembered.
          token.expiresAt = expiryFor(true);
        }
        return token;
      }

      if (user) {
        const u = user as unknown as {
          id: string;
          kind: UserKind;
          role: Role | null;
          customerId: string | null;
          salesTeamId: string | null;
          remember?: boolean;
        };
        token.uid = u.id;
        token.kind = u.kind;
        token.role = u.role;
        token.customerId = u.customerId;
        token.salesTeamId = u.salesTeamId;
        token.expiresAt = expiryFor(u.remember ?? false);
      }
      return token;
    },

    session({ session, token }) {
      session.user = {
        ...session.user,
        id: token.uid,
        kind: token.kind,
        role: token.role,
        customerId: token.customerId,
        salesTeamId: token.salesTeamId,
        expiresAt: token.expiresAt,
      };
      return session;
    },
  },
});

/**
 * When this session stops being valid.
 *
 * The cookie always carries the 30-day maxAge, because Auth.js accepts one
 * static value. This claim is the real answer, and `getCurrentUser` enforces
 * it - which is what makes "remember this workstation" mean something rather
 * than decorate the form.
 */
function expiryFor(remember: boolean): number {
  const hours = remember ? REMEMBERED_DAYS * 24 : UNREMEMBERED_HOURS;
  return currentBusinessTime().getTime() + hours * 60 * 60 * 1000;
}

/**
 * The authorisation subject for `can()` and `scopeFor()`. Returns null when
 * unauthenticated so callers fail closed.
 */
export async function getCurrentUser(): Promise<AuthzUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  // A session the user did not ask us to remember expires sooner than the
  // cookie does. Fail closed when it has.
  const expiresAt = session.user.expiresAt;
  if (typeof expiresAt === "number" && currentBusinessTime().getTime() > expiresAt) {
    return null;
  }

  /**
   * The token says who they are; the database says whether they still exist.
   *
   * This is a JWT strategy, so the session is self-contained and was trusted
   * whole - which meant two things stayed true for as long as the cookie lived.
   * Deactivating a user did not sign them out: `active: false` is checked when
   * they log in and never again, so a revoked account kept working for up to
   * thirty days. And a session naming a user who is simply gone stayed
   * "authenticated", so any screen that read the user's own record met a row
   * that was not there and returned a 500 instead of a sign-in page. Resetting
   * the demo database made that second case immediate: every id in every open
   * tab pointed at a user that no longer existed.
   *
   * One indexed primary-key lookup per request is the price of revocation
   * actually revoking. That is worth paying.
   */
  const live = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, kind: true, role: true, customerId: true, salesTeamId: true, active: true },
  });
  if (!live || !live.active) return null;

  // Read back from the row rather than the token, so a role or team changed by
  // an administrator takes effect on the next request instead of at next login.
  return {
    id: live.id,
    kind: live.kind,
    role: live.role,
    customerId: live.customerId,
    salesTeamId: live.salesTeamId,
  };
}


/**
 * The user for a staff-only screen, or a redirect away from it.
 *
 * Every internal page used to ask only "is anyone signed in?", which let a
 * portal identity reach the internal boards. The services refuse them their
 * data now, but a customer landing on a staff screen should be sent to their
 * own rather than shown an error - so the kind is checked here, once, instead
 * of in six pages that each have to remember.
 */
export async function requireInternalUser(callbackPath: string): Promise<AuthzUser> {
  // On a process serving only the customer portal there is no staff workspace
  // to render, whoever is asking.
  assertServesInternal();

  const user = await getCurrentUser();
  if (!user) redirect(`/login?callbackUrl=${encodeURIComponent(callbackPath)}`);
  if (user.kind === "PORTAL") redirect("/my/quotations");
  return user;
}
