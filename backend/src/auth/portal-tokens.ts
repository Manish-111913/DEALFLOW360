import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { currentBusinessTime } from "../clock";
import { prisma } from "../db";

/**
 * D18 — portal access by signed, expiring magic link.
 *
 * §A1 of the problem statement offers "magic link, or email and password" for
 * customers. The link is chosen because it is cheaper to build, matches the
 * demo script ("Customer receives the quotation link"), and makes the portal
 * visibly a separate surface rather than a second login box.
 *
 * The raw token is returned to the caller once and never stored — only its
 * SHA-256. A database read therefore cannot be replayed as a login.
 */

const TOKEN_BYTES = 32;

function defaultTtlMinutes(): number {
  const raw = Number(process.env.PORTAL_LINK_TTL_MINUTES);
  return Number.isFinite(raw) && raw > 0 ? raw : 30;
}

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export interface IssuedPortalLink {
  /** Shown once. Not recoverable from the database. */
  rawToken: string;
  expiresAt: Date;
}

export async function issuePortalLink(
  customerId: string,
  ttlMinutes = defaultTtlMinutes(),
): Promise<IssuedPortalLink> {
  const rawToken = randomBytes(TOKEN_BYTES).toString("base64url");
  const now = currentBusinessTime();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000);

  await prisma.portalAccessToken.create({
    data: {
      customerId,
      tokenHash: hashToken(rawToken),
      expiresAt,
      createdAt: now,
    },
  });

  return { rawToken, expiresAt };
}

export type PortalTokenRejection =
  | "unknown"
  | "expired"
  | "already_used"
  | "no_portal_user";

export type ConsumeResult =
  | { ok: true; userId: string; customerId: string }
  | { ok: false; reason: PortalTokenRejection };

/**
 * Validate and burn a link. Single-use: the second presentation of the same
 * token is refused even while it is still inside its lifetime.
 */
export async function consumePortalLink(rawToken: string): Promise<ConsumeResult> {
  const tokenHash = hashToken(rawToken);
  const record = await prisma.portalAccessToken.findUnique({ where: { tokenHash } });

  if (!record) return { ok: false, reason: "unknown" };

  // Constant-time compare on the stored hash. The lookup above is already by
  // hash, so this guards only against a future change to a scan-based lookup;
  // it costs nothing to keep the comparison safe by construction.
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

  const portalUser = await prisma.user.findFirst({
    where: { customerId: record.customerId, kind: "PORTAL", active: true },
    orderBy: { createdAt: "asc" },
  });
  if (!portalUser) return { ok: false, reason: "no_portal_user" };

  // Burn the token atomically.
  //
  // The consumedAt check above is a fast path, not the guarantee: between that
  // read and this write, a second request presenting the same link could pass
  // the same check. The conditional update closes that window - it only matches
  // while consumedAt is still null, so exactly one caller can ever win, and the
  // loser is told the link was already used.
  const burned = await prisma.portalAccessToken.updateMany({
    where: { id: record.id, consumedAt: null },
    data: { consumedAt: now },
  });
  if (burned.count === 0) return { ok: false, reason: "already_used" };

  return { ok: true, userId: portalUser.id, customerId: record.customerId };
}
