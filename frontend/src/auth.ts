import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import {
  consumePortalLink,
  prisma,
  verifyPassword,
  type AuthzUser,
  type Role,
  type UserKind,
} from "@dealflow/backend";

/**
 * Two providers, two surfaces.
 *
 * Internal users sign in with email and password. Portal users present a
 * single-use magic link (D18). They are separate providers rather than one
 * with a branch, so a portal credential can never authenticate an internal
 * account by accident.
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
export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  trustHost: true,
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      id: "internal",
      name: "Internal",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").trim().toLowerCase();
        const password = String(credentials?.password ?? "");
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
    jwt({ token, user }) {
      if (user) {
        const u = user as unknown as {
          id: string;
          kind: UserKind;
          role: Role | null;
          customerId: string | null;
          salesTeamId: string | null;
        };
        token.uid = u.id;
        token.kind = u.kind;
        token.role = u.role;
        token.customerId = u.customerId;
        token.salesTeamId = u.salesTeamId;
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
      };
      return session;
    },
  },
});

/**
 * The authorisation subject for `can()` and `scopeFor()`. Returns null when
 * unauthenticated so callers fail closed.
 */
export async function getCurrentUser(): Promise<AuthzUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    kind: session.user.kind,
    role: session.user.role,
    customerId: session.user.customerId,
    salesTeamId: session.user.salesTeamId,
  };
}
