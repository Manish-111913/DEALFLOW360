import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { consumePortalLink, issuePortalLink } from "./portal-tokens";
import { advanceClock, currentBusinessTime, resetClock } from "../clock";
import { prisma } from "../db";

let customerId: string;
let portalUserId: string;
const suffix = Date.parse("2026-01-01") + Math.floor(Math.random() * 1e6);

beforeAll(async () => {
  const now = currentBusinessTime();
  const customer = await prisma.customer.create({
    data: { name: `Token Test Co ${suffix}`, tier: "BRONZE", createdAt: now, updatedAt: now },
  });
  customerId = customer.id;

  const user = await prisma.user.create({
    data: {
      email: `token-test-${suffix}@example.test`,
      name: "Token Test Buyer",
      kind: "PORTAL",
      customerId,
      createdAt: now,
      updatedAt: now,
    },
  });
  portalUserId = user.id;
});

afterAll(async () => {
  await resetClock("test");
  await prisma.portalAccessToken.deleteMany({ where: { customerId } });
  await prisma.user.deleteMany({ where: { id: portalUserId } });
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.$disconnect();
});

describe("D18 — portal magic links", () => {
  it("authenticates the customer's portal user", async () => {
    const { rawToken } = await issuePortalLink(customerId);
    const result = await consumePortalLink(rawToken);

    expect(result).toEqual({ ok: true, userId: portalUserId, customerId });
  });

  it("is single use", async () => {
    const { rawToken } = await issuePortalLink(customerId);

    expect((await consumePortalLink(rawToken)).ok).toBe(true);
    expect(await consumePortalLink(rawToken)).toEqual({ ok: false, reason: "already_used" });
  });

  it("rejects an unknown token", async () => {
    expect(await consumePortalLink("not-a-real-token")).toEqual({
      ok: false,
      reason: "unknown",
    });
  });

  // Expiry is asserted by moving the application clock rather than sleeping,
  // which is the same mechanism the demo uses (D3).
  it("expires", async () => {
    const { rawToken } = await issuePortalLink(customerId, 1);
    await advanceClock({ minutes: 5 }, "test");

    expect(await consumePortalLink(rawToken)).toEqual({ ok: false, reason: "expired" });
    await resetClock("test");
  });

  it("never stores the raw token", async () => {
    const { rawToken } = await issuePortalLink(customerId);
    const stored = await prisma.portalAccessToken.findMany({ where: { customerId } });

    expect(stored.length).toBeGreaterThan(0);
    for (const row of stored) {
      expect(row.tokenHash).not.toBe(rawToken);
      expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
