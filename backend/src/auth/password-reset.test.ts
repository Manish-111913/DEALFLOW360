import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../db";
import { verifyPassword } from "./password";
import { requestPasswordReset, resetPassword } from "./password-reset";
import { registerInternalUser } from "./register";

const VALID_PASSWORD = "Correct-Horse-9";
const created: string[] = [];

async function freshUser() {
  const user = await registerInternalUser({
    email: `reset-${Math.random().toString(36).slice(2)}@example.test`,
    name: "Reset Subject",
    password: VALID_PASSWORD,
    role: "SALES_REP",
  });
  created.push(user.id);
  return user;
}

afterAll(async () => {
  await prisma.user.updateMany({ where: { id: { in: created } }, data: { active: false } });
  await prisma.$disconnect();
});

describe("requesting a reset", () => {
  it("issues a token for a real internal account", async () => {
    const user = await freshUser();
    const issued = await requestPasswordReset(user.email);

    expect(issued.rawToken).toBeTruthy();
    expect(issued.expiresAt).toBeInstanceOf(Date);
  });

  it("stores only the hash, never the token itself", async () => {
    const user = await freshUser();
    const issued = await requestPasswordReset(user.email);

    const stored = await prisma.passwordResetToken.findFirst({ where: { userId: user.id } });
    expect(stored).not.toBeNull();
    expect(stored!.tokenHash).not.toBe(issued.rawToken);
  });

  it("says nothing about an address it does not hold", async () => {
    // The absence of an error is the point: this must not be an oracle for
    // whether an address has an account.
    const issued = await requestPasswordReset("nobody-here@example.test");
    expect(issued.rawToken).toBeNull();
  });

  it("refuses a portal identity, which has no password", async () => {
    const issued = await requestPasswordReset("buyer@acme.test");
    expect(issued.rawToken).toBeNull();
  });

  it("burns the previous link when a second is requested", async () => {
    const user = await freshUser();
    const first = await requestPasswordReset(user.email);
    await requestPasswordReset(user.email);

    const result = await resetPassword(first.rawToken!, "Replacement-Pass-1!");
    expect(result).toEqual({ ok: false, reason: "already_used" });
  });
});

describe("completing a reset", () => {
  it("sets the new password and lets it verify", async () => {
    const user = await freshUser();
    const { rawToken } = await requestPasswordReset(user.email);

    const result = await resetPassword(rawToken!, "Replacement-Pass-1!");
    expect(result.ok).toBe(true);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword("Replacement-Pass-1!", after.passwordHash!)).toBe(true);
    expect(await verifyPassword(VALID_PASSWORD, after.passwordHash!)).toBe(false);
  });

  it("is single use", async () => {
    const user = await freshUser();
    const { rawToken } = await requestPasswordReset(user.email);

    await resetPassword(rawToken!, "Replacement-Pass-1!");
    const second = await resetPassword(rawToken!, "Another-Password-2!");
    expect(second).toEqual({ ok: false, reason: "already_used" });
  });

  it("refuses an unknown token", async () => {
    const result = await resetPassword("not-a-real-token", "Replacement-Pass-1!");
    expect(result).toEqual({ ok: false, reason: "unknown" });
  });

  it("refuses an expired token", async () => {
    const user = await freshUser();
    // Issued already expired, rather than waiting for the clock.
    const { rawToken } = await requestPasswordReset(user.email, -1);

    const result = await resetPassword(rawToken!, "Replacement-Pass-1!");
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("reports every broken policy rule, and leaves the link usable", async () => {
    const user = await freshUser();
    const { rawToken } = await requestPasswordReset(user.email);

    const weak = await resetPassword(rawToken!, "short");
    expect(weak.ok).toBe(false);
    if (weak.ok) throw new Error("unreachable");
    expect(weak.reason).toBe("weak_password");
    expect(weak.problems!.length).toBeGreaterThan(1);

    // A rejected password must not cost the user their recovery link.
    const retry = await resetPassword(rawToken!, "Replacement-Pass-1!");
    expect(retry.ok).toBe(true);
  });
});
