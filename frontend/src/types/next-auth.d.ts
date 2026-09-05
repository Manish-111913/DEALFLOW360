import type { DefaultSession } from "next-auth";
import type { Role, UserKind } from "@dealflow/backend";

declare module "next-auth" {
  /**
   * Extra claims carried by the object `authorize()` returns.
   *
   * Optional, because Google's provider builds a User from its own profile and
   * knows nothing about our roles - the `jwt` callback fills those in from the
   * database for that path. Requiring them here would only be a type error
   * against the provider, not a guarantee about the value.
   */
  interface User {
    kind?: UserKind;
    role?: Role | null;
    customerId?: string | null;
    salesTeamId?: string | null;
    /** Set by the internal credentials provider from the sign-in checkbox. */
    remember?: boolean;
  }

  interface Session {
    /**
     * Intersected with the default user rather than replacing it, so
     * adapter-supplied fields (emailVerified, image) survive.
     */
    user: {
      id: string;
      kind: UserKind;
      role: Role | null;
      customerId: string | null;
      salesTeamId: string | null;
      /** Epoch ms. See `expiryFor` - this is what "remember me" controls. */
      expiresAt?: number;
    } & DefaultSession["user"];
  }
}

/**
 * Augment `@auth/core/jwt`, not `next-auth/jwt`.
 *
 * `next-auth/jwt` is `export * from "@auth/core/jwt"` — a re-export, so
 * declaration merging against it does not reach the interface the callbacks
 * actually use. JWT also extends Record<string, unknown>, which is why an
 * un-augmented claim types as `unknown` rather than failing outright.
 */
declare module "@auth/core/jwt" {
  interface JWT {
    uid: string;
    kind: UserKind;
    role: Role | null;
    customerId: string | null;
    salesTeamId: string | null;
    /** Epoch ms; enforced by getCurrentUser, not by the cookie. */
    expiresAt?: number;
  }
}

export {};
