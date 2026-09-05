import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { appendAudit } from "../audit";
import { currentBusinessTime } from "../clock";
import { prisma } from "../db";
import { hashPassword } from "./password";
import { failedPasswordRules } from "./password-policy";

/**
 * Self-service password recovery, for the "Forgot Password" and "Reset" tabs.
 *
 * Built the same way as the portal magic link (D18): only the SHA-256 of the
 * token is stored, so a database read cannot be replayed as a password reset,
 * and the link burns on first use.
 *
 * Two rules here are about not leaking who banks with us:
 *
 *  - Requesting a reset for an address we do not hold returns success, not
 *    "no such user". Otherwise the form is an account-existence oracle any
 *    stranger can query.
 *  - Portal identities are skipped. They have no password to reset (D18), and
 *    saying so would confirm the address belongs to a customer contact.
 */

const TOKEN_BYTES = 32;

function defaultTtlMinutes(): number {
  const raw = Number(process.env.PASSWORD_RESET_TTL_MINUTES);
  return Number.isFinite(raw) && raw > 0 ? raw : 15;
}

function hashResetToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export interface PasswordResetRequest {
  /**
   * Present only when the address matched a resettable account. Null is the
   * normal, non-exceptional answer for an unknown address - the caller still
   * reports success to the user.
   */
  rawToken: string | null;
  expiresAt: Date | null;
}

/**
 * Issue a recovery link for an email address, if it belongs to one.
 *
 * Any unconsumed token for the same user is burned first, so the most recent
 * link is the only live one - a user who clicks "resend" three times does not
 * leave three working keys behind.
 */
export async function requestPasswordReset(
  email: string,
  ttlMinutes = defaultTtlMinutes(),
): Promise<PasswordResetRequest> {
  const normalised = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalised } });

  // Deliberately indistinguishable from success, from the caller's side.
  if (!user || !user.active || user.kind !== "INTERNAL") {
    return { rawToken: null, expiresAt: null };
  }

  const now = currentBusinessTime();
  const rawToken = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000);

  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: now },
    }),
    prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashResetToken(rawToken),
        expiresAt,
        createdAt: now,
      },
    }),
  ]);

  return { rawToken, expiresAt };
}

export type ResetRejection = "unknown" | "expired" | "already_used" | "weak_password";

export type ResetResult =
  | { ok: true; email: string }
  | { ok: false; reason: ResetRejection; problems?: string[] };

/**
 * Validate a recovery token and set the new password.
 *
 * The password is checked before the token is burned: a user whose new password
 * fails the policy should be able to try again on the same link rather than
 * having to request another one.
 */
export async function resetPassword(
  rawToken: string,
  newPassword: string,
): Promise<ResetResult> {
  const tokenHash = hashResetToken(rawToken);
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!record) return { ok: false, reason: "unknown" };

  const a = Buffer.from(record.tokenHash);
  const b = Buffer.from(tokenHash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "unknown" };
  }

  if (record.consumedAt) return { ok: false, reason: "already_used" };

  const now = currentBusinessTime();
  if (record.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }

  const problems = failedPasswordRules(newPassword).map((rule) => rule.label);
  if (problems.length > 0) {
    return { ok: false, reason: "weak_password", problems };
  }

  // Burn and set together: the conditional update means only one of two
  // simultaneous presentations of the same link can win.
  const burned = await prisma.passwordResetToken.updateMany({
    where: { id: record.id, consumedAt: null },
    data: { consumedAt: now },
  });
  if (burned.count === 0) return { ok: false, reason: "already_used" };

  await prisma.user.update({
    where: { id: record.userId },
    data: { passwordHash: await hashPassword(newPassword), updatedAt: now },
  });

  await appendAudit({
    entityName: "User",
    entityId: record.userId,
    action: "UPDATE",
    actorId: record.userId,
    reason: "Password reset via recovery link",
    // Never the password, nor the token. That it happened, and when.
    fieldChanges: { passwordHash: "reset" },
  });

  return { ok: true, email: record.user.email };
}
