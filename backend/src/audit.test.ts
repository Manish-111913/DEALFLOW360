import { afterAll, describe, expect, it } from "vitest";
import { appendAudit, computeAuditHash, GENESIS_HASH, verifyAuditChain } from "./audit";
import { currentBusinessTime } from "./clock";
import { prisma } from "./db";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("hash computation", () => {
  const base = {
    entityName: "Quotation",
    entityId: "q-1",
    action: "APPROVE" as const,
    actorId: "u-1",
    reason: "Within ceiling",
    fieldChanges: { a: 1, b: 2 },
    timestamp: new Date("2026-01-01T00:00:00.000Z"),
  };

  it("is deterministic", () => {
    expect(computeAuditHash(GENESIS_HASH, base)).toBe(computeAuditHash(GENESIS_HASH, base));
  });

  // JSON.stringify does not guarantee key order, so an unstable payload would
  // make a perfectly valid chain fail verification later.
  it("does not depend on object key order in fieldChanges", () => {
    const reordered = { ...base, fieldChanges: { b: 2, a: 1 } };
    expect(computeAuditHash(GENESIS_HASH, reordered)).toBe(computeAuditHash(GENESIS_HASH, base));
  });

  it("changes when the predecessor changes", () => {
    expect(computeAuditHash("other-prev", base)).not.toBe(computeAuditHash(GENESIS_HASH, base));
  });

  it("changes when any covered field changes", () => {
    const original = computeAuditHash(GENESIS_HASH, base);
    expect(computeAuditHash(GENESIS_HASH, { ...base, reason: "Different" })).not.toBe(original);
    expect(computeAuditHash(GENESIS_HASH, { ...base, actorId: "u-2" })).not.toBe(original);
    expect(computeAuditHash(GENESIS_HASH, { ...base, action: "REJECT" })).not.toBe(original);
  });
});

describe("chain integrity", () => {
  it("links each appended row to its predecessor and verifies end to end", async () => {
    const entityId = `probe-${currentBusinessTime().getTime()}`;

    const first = await appendAudit({
      entityName: "TestProbe",
      entityId,
      action: "CREATE",
      reason: "chain test 1",
    });
    const second = await appendAudit({
      entityName: "TestProbe",
      entityId,
      action: "UPDATE",
      reason: "chain test 2",
      fieldChanges: { before: 1, after: 2 },
    });

    expect(second.prevHash).toBe(first.hash);

    const result = await verifyAuditChain();
    expect(result.ok).toBe(true);
    expect(result.brokenAtSeq).toBeUndefined();
    expect(result.checked).toBeGreaterThanOrEqual(2);
  });
});

describe("D19 — the database refuses mutation, not just the application", () => {
  // "No update function exists" is a property of today's code. These assert the
  // property of the data, which survives a refactor or a psql prompt.
  it("refuses UPDATE", async () => {
    const row = await appendAudit({
      entityName: "TestProbe",
      entityId: "immutability",
      action: "CREATE",
      reason: "original",
    });

    await expect(
      prisma.$executeRaw`UPDATE "AuditLog" SET reason = 'tampered' WHERE seq = ${row.seq}`,
    ).rejects.toThrow(/append-only/i);

    const reread = await prisma.auditLog.findUnique({ where: { seq: row.seq } });
    expect(reread?.reason).toBe("original");
  });

  it("refuses DELETE", async () => {
    const row = await appendAudit({
      entityName: "TestProbe",
      entityId: "immutability",
      action: "CREATE",
      reason: "keep me",
    });

    await expect(
      prisma.$executeRaw`DELETE FROM "AuditLog" WHERE seq = ${row.seq}`,
    ).rejects.toThrow(/append-only/i);

    expect(await prisma.auditLog.findUnique({ where: { seq: row.seq } })).not.toBeNull();
  });

  it("refuses TRUNCATE", async () => {
    await expect(prisma.$executeRawUnsafe('TRUNCATE "AuditLog"')).rejects.toThrow(
      /append-only/i,
    );
  });
});
