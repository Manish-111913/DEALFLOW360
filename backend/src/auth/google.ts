import { appendAudit } from "../audit";
import { currentBusinessTime } from "../clock";
import { prisma } from "../db";
import type { Role } from "../generated/prisma/enums";

/**
 * Google Workspace sign-in.
 *
 * The thing worth being careful about: holding a Google account is not the same
 * as being staff. Anyone on earth can present a valid Google identity, so
 * "the token verified" must not by itself create an internal user with a data
 * scope. Three questions are answered separately here:
 *
 *   1. Did Google verify the address?  (unverified is refused outright)
 *   2. Do we already have this person? (then Google is just a second way in)
 *   3. If not, may they self-provision? (only from an allowlisted domain)
 *
 * With no allowlist configured the answer to 3 is always no, which is the safe
 * default: Google then works for existing staff and for nobody else.
 *
 * Portal identities are refused regardless. A customer contact's surface is the
 * magic link (D18); letting their Google account open a staff session would
 * hand them the internal side of the product.
 */

/** Domains permitted to self-provision, from GOOGLE_ALLOWED_DOMAINS. */
export function allowedDomains(): string[] {
  return (process.env.GOOGLE_ALLOWED_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

/** The role a self-provisioned Google user starts with. Least privilege. */
function defaultRole(): Role {
  const raw = (process.env.GOOGLE_DEFAULT_ROLE ?? "").toUpperCase();
  const known: Role[] = ["SALES_REP", "SALES_MANAGER", "FINANCE_OPS", "ADMIN"];
  return (known as string[]).includes(raw) ? (raw as Role) : "SALES_REP";
}

function domainOf(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

export type GoogleRejection =
  | "no_email"
  | "unverified_email"
  | "portal_identity"
  | "inactive"
  | "not_provisioned";

export type GoogleSignInResult =
  | { ok: true; userId: string; created: boolean }
  | { ok: false; reason: GoogleRejection };

export interface GoogleProfile {
  email: string | null | undefined;
  emailVerified: boolean;
  name: string | null | undefined;
  /** Google's stable user id, stored so a later email change still resolves. */
  providerAccountId: string;
}

/**
 * Resolve a Google identity to one of our users, provisioning only if allowed.
 *
 * Returns a reason rather than throwing, because every rejection here is a
 * message a sign-in screen has to render, not a bug.
 */
export async function resolveGoogleSignIn(
  profile: GoogleProfile,
): Promise<GoogleSignInResult> {
  const email = profile.email?.trim().toLowerCase();
  if (!email) return { ok: false, reason: "no_email" };
  if (!profile.emailVerified) return { ok: false, reason: "unverified_email" };

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    if (existing.kind !== "INTERNAL") return { ok: false, reason: "portal_identity" };
    if (!existing.active) return { ok: false, reason: "inactive" };
    await linkGoogleAccount(existing.id, profile.providerAccountId);
    return { ok: true, userId: existing.id, created: false };
  }

  if (!allowedDomains().includes(domainOf(email))) {
    return { ok: false, reason: "not_provisioned" };
  }

  const now = currentBusinessTime();
  const user = await prisma.user.create({
    data: {
      email,
      name: profile.name?.trim() || email,
      kind: "INTERNAL",
      role: defaultRole(),
      // No password of ours exists for a Google account. Leaving this null is
      // what stops the credentials provider from ever matching it.
      passwordHash: null,
      createdAt: now,
      updatedAt: now,
    },
  });

  await linkGoogleAccount(user.id, profile.providerAccountId);

  await appendAudit({
    entityName: "User",
    entityId: user.id,
    action: "CREATE",
    actorId: user.id,
    reason: "Provisioned via Google Workspace sign-in",
    fieldChanges: { email: user.email, role: user.role, domain: domainOf(email) },
  });

  return { ok: true, userId: user.id, created: true };
}

/**
 * Record the Google account against the user.
 *
 * Written by hand rather than by an Auth.js adapter because our User model
 * requires `kind`, `name`, `createdAt` and `updatedAt`, none of which an
 * adapter's generic createUser knows how to fill.
 */
export async function linkGoogleAccount(
  userId: string,
  providerAccountId: string,
): Promise<void> {
  await prisma.account.upsert({
    where: { provider_providerAccountId: { provider: "google", providerAccountId } },
    update: { userId },
    create: { userId, type: "oauth", provider: "google", providerAccountId },
  });
}

/** What the sign-in screen tells the user for each refusal. */
export const GOOGLE_REJECTION_MESSAGE: Record<GoogleRejection, string> = {
  no_email: "Google did not return an email address for this account.",
  unverified_email: "This Google account has an unverified email address.",
  portal_identity:
    "This address belongs to a customer portal account. Please use the link in your quotation email.",
  inactive: "This account has been deactivated. Contact your administrator.",
  not_provisioned:
    "No DealFlow360 account exists for this Google address. Ask an administrator to invite you, or sign in with your work email and password.",
};
