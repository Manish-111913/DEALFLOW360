import { createHash } from "node:crypto";
import type { AuditAction } from "./generated/prisma/enums";
import { currentBusinessTime } from "./clock";
import { prisma } from "./db";
import { ADVISORY_LOCK } from "./locks";

/**
 * D19 — append-only, tamper-evident audit log.
 *
 * Two independent guarantees:
 *
 *  1. Append-only. This module exposes no update or delete function, and the
 *     database refuses UPDATE, DELETE and TRUNCATE on the table via trigger
 *     (see the b1 migration). The absence of a code path is a property of
 *     today's code; the trigger is a property of the data.
 *
 *  2. Tamper-evident. Each row's hash covers the previous row's hash, so
 *     altering or removing any historical row breaks verification of every row
 *     after it. Detection, not prevention — but combined with (1) it means a
 *     changed audit trail cannot be made to look untouched.
 */

/** prevHash of the first row in the chain. */
export const GENESIS_HASH = "GENESIS";

export interface AuditInput {
  entityName: string;
  entityId: string;
  action: AuditAction;
  actorId?: string | null;
  reason?: string | null;
  /** Before/after pairs. Omit for actions that are self-explanatory. */
  fieldChanges?: unknown;
}

/**
 * Deterministic serialisation. `JSON.stringify` does not guarantee key order
 * for arbitrary objects, and an unstable payload would make a correct chain
 * fail verification.
 */
function canonicalise(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) {
    return `[${value.map(canonicalise).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

interface HashableEntry {
  entityName: string;
  entityId: string;
  action: AuditAction;
  actorId: string | null;
  reason: string | null;
  fieldChanges: unknown;
  timestamp: Date;
}

export function computeAuditHash(prevHash: string, entry: HashableEntry): string {
  const payload = canonicalise({
    prevHash,
    entityName: entry.entityName,
    entityId: entry.entityId,
    action: entry.action,
    actorId: entry.actorId,
    reason: entry.reason,
    fieldChanges: entry.fieldChanges ?? null,
    timestamp: entry.timestamp.toISOString(),
  });
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Append one entry. Serialised by a transaction-scoped advisory lock: two
 * concurrent appends would otherwise both read the same tail row and write two
 * rows claiming the same predecessor.
 */
export async function appendAudit(input: AuditInput) {
  const timestamp = currentBusinessTime();

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK.auditChain})`;

    const tail = await tx.auditLog.findFirst({
      orderBy: { seq: "desc" },
      select: { hash: true },
    });
    const prevHash = tail?.hash ?? GENESIS_HASH;

    const entry: HashableEntry = {
      entityName: input.entityName,
      entityId: input.entityId,
      action: input.action,
      actorId: input.actorId ?? null,
      reason: input.reason ?? null,
      fieldChanges: input.fieldChanges ?? null,
      timestamp,
    };

    return tx.auditLog.create({
      data: {
        entityName: entry.entityName,
        entityId: entry.entityId,
        action: entry.action,
        actorId: entry.actorId,
        reason: entry.reason,
        fieldChanges: (entry.fieldChanges ?? undefined) as never,
        timestamp,
        prevHash,
        hash: computeAuditHash(prevHash, entry),
      },
    });
  });
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  /** First row whose recomputed hash or predecessor link does not match. */
  brokenAtSeq?: number;
  detail?: string;
}

/** Recompute the whole chain and report the first inconsistency. */
export async function verifyAuditChain(): Promise<ChainVerification> {
  const rows = await prisma.auditLog.findMany({ orderBy: { seq: "asc" } });

  let expectedPrev = GENESIS_HASH;
  for (const row of rows) {
    if (row.prevHash !== expectedPrev) {
      return {
        ok: false,
        checked: rows.length,
        brokenAtSeq: row.seq,
        detail: `prevHash mismatch: stored ${row.prevHash}, expected ${expectedPrev}`,
      };
    }
    const recomputed = computeAuditHash(row.prevHash, {
      entityName: row.entityName,
      entityId: row.entityId,
      action: row.action,
      actorId: row.actorId,
      reason: row.reason,
      fieldChanges: row.fieldChanges ?? null,
      timestamp: row.timestamp,
    });
    if (recomputed !== row.hash) {
      return {
        ok: false,
        checked: rows.length,
        brokenAtSeq: row.seq,
        detail: `content hash mismatch: stored ${row.hash}, recomputed ${recomputed}`,
      };
    }
    expectedPrev = row.hash;
  }

  return { ok: true, checked: rows.length };
}

/** Read the trail for one record. Read-only by construction. */
export async function auditTrailFor(entityName: string, entityId: string) {
  return prisma.auditLog.findMany({
    where: { entityName, entityId },
    orderBy: { seq: "asc" },
  });
}
