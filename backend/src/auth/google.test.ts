import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../db";
import { resolveGoogleSignIn } from "./google";
import { registerInternalUser } from "./register";

const created: string[] = [];

function profile(overrides: Partial<Parameters<typeof resolveGoogleSignIn>[0]> = {}) {
  return {
    email: "someone@example.test",
    emailVerified: true,
    name: "Some One",
    providerAccountId: `g-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await prisma.user.updateMany({ where: { id: { in: created } }, data: { active: false } });
  await prisma.$disconnect();
});

describe("an existing internal user", () => {
  it("is let in and has the Google account linked", async () => {
    const user = await registerInternalUser({
      email: `google-${Math.random().toString(36).slice(2)}@example.test`,
      name: "Already Staff",
      password: "Correct-Horse-9",
      role: "SALES_REP",
    });
    created.push(user.id);

    const providerAccountId = `g-${Math.random().toString(36).slice(2)}`;
    const result = await resolveGoogleSignIn(
      profile({ email: user.email.toUpperCase(), providerAccountId }),
    );

    expect(result).toEqual({ ok: true, userId: user.id, created: false });

    const link = await prisma.account.findUnique({
      where: { provider_providerAccountId: { provider: "google", providerAccountId } },
    });
    expect(link?.userId).toBe(user.id);
  });

  it("is refused once deactivated", async () => {
    const user = await registerInternalUser({
      email: `disabled-${Math.random().toString(36).slice(2)}@example.test`,
      name: "No Longer Here",
      password: "Correct-Horse-9",
      role: "SALES_REP",
    });
    created.push(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { active: false } });

    const result = await resolveGoogleSignIn(profile({ email: user.email }));
    expect(result).toEqual({ ok: false, reason: "inactive" });
  });
});

describe("identities that must never open a staff session", () => {
  it("refuses a portal customer's address", async () => {
    // A customer contact's surface is the magic link (D18). Their Google
    // account must not become a way onto the internal side.
    const result = await resolveGoogleSignIn(profile({ email: "buyer@acme.test" }));
    expect(result).toEqual({ ok: false, reason: "portal_identity" });
  });

  it("refuses an unverified Google address", async () => {
    const result = await resolveGoogleSignIn(profile({ emailVerified: false }));
    expect(result).toEqual({ ok: false, reason: "unverified_email" });
  });

  it("refuses a profile with no address at all", async () => {
    const result = await resolveGoogleSignIn(profile({ email: null }));
    expect(result).toEqual({ ok: false, reason: "no_email" });
  });
});

describe("self-provisioning is off unless a domain is allowlisted", () => {
  it("refuses an unknown address when no allowlist is configured", async () => {
    vi.stubEnv("GOOGLE_ALLOWED_DOMAINS", "");

    const result = await resolveGoogleSignIn(
      profile({ email: `stranger-${Math.random().toString(36).slice(2)}@gmail.com` }),
    );
    expect(result).toEqual({ ok: false, reason: "not_provisioned" });
  });

  it("refuses a domain that is not on the list", async () => {
    vi.stubEnv("GOOGLE_ALLOWED_DOMAINS", "dealflow360.test");

    const result = await resolveGoogleSignIn(
      profile({ email: `outsider-${Math.random().toString(36).slice(2)}@elsewhere.test` }),
    );
    expect(result).toEqual({ ok: false, reason: "not_provisioned" });
  });

  it("provisions from an allowlisted domain, at the least-privilege role", async () => {
    vi.stubEnv("GOOGLE_ALLOWED_DOMAINS", "allowed.test");

    const email = `newjoiner-${Math.random().toString(36).slice(2)}@allowed.test`;
    const result = await resolveGoogleSignIn(profile({ email, name: "New Joiner" }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.created).toBe(true);
    created.push(result.userId);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: result.userId } });
    expect(user.kind).toBe("INTERNAL");
    expect(user.role).toBe("SALES_REP");
    // No password of ours exists, which is what stops the credentials provider
    // from ever matching this account.
    expect(user.passwordHash).toBeNull();
  });

  it("honours GOOGLE_DEFAULT_ROLE when it names a real role", async () => {
    vi.stubEnv("GOOGLE_ALLOWED_DOMAINS", "allowed.test");
    vi.stubEnv("GOOGLE_DEFAULT_ROLE", "FINANCE_OPS");

    const email = `finance-${Math.random().toString(36).slice(2)}@allowed.test`;
    const result = await resolveGoogleSignIn(profile({ email }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    created.push(result.userId);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: result.userId } });
    expect(user.role).toBe("FINANCE_OPS");
  });

  it("falls back to SALES_REP when GOOGLE_DEFAULT_ROLE is nonsense", async () => {
    vi.stubEnv("GOOGLE_ALLOWED_DOMAINS", "allowed.test");
    vi.stubEnv("GOOGLE_DEFAULT_ROLE", "SUPREME_LEADER");

    const email = `nonsense-${Math.random().toString(36).slice(2)}@allowed.test`;
    const result = await resolveGoogleSignIn(profile({ email }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    created.push(result.userId);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: result.userId } });
    expect(user.role).toBe("SALES_REP");
  });

  it("signs the same person in a second time without creating a duplicate", async () => {
    vi.stubEnv("GOOGLE_ALLOWED_DOMAINS", "allowed.test");

    const email = `returning-${Math.random().toString(36).slice(2)}@allowed.test`;
    const first = await resolveGoogleSignIn(profile({ email }));
    const second = await resolveGoogleSignIn(profile({ email }));

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("unreachable");
    created.push(first.userId);

    expect(second.userId).toBe(first.userId);
    expect(second.created).toBe(false);
  });
});
