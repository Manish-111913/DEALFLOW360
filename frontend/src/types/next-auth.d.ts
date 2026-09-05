import type { DefaultSession } from "next-auth";
import type { Role, UserKind } from "@dealflow/backend";

declare module "next-auth" {
  /** Extra claims carried by the object `authorize()` returns. */
  interface User {
    kind: UserKind;
    role: Role | null;
    customerId: string | null;
    salesTeamId: string | null;
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
  }
}

export {};
