import { redirect } from "next/navigation";
import NextAuth from "next-auth";
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
  return {
    id: session.user.id,
    kind: session.user.kind,
    role: session.user.role,
    customerId: session.user.customerId,
    salesTeamId: session.user.salesTeamId,
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
  const user = await getCurrentUser();
  if (!user) redirect(`/login?callbackUrl=${encodeURIComponent(callbackPath)}`);
  if (user.kind === "PORTAL") redirect("/negotiation");
  return user;
}
