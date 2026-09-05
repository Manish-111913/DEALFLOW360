import { prisma } from "./db";

/**
 * D3 — the application clock.
 *
 * This is the ONLY module permitted to read the host system clock. Everything
 * else — engines, model defaults, seeds, tests, route handlers — calls
 * `currentBusinessTime()`. An ESLint rule enforces that, and this file is its
 * single exemption.
 *
 * The reason is not tidiness. Recurring billing, stalled-deal detection,
 * approval-delay penalties and delivery slippage are all time-dependent, and
 * none of them can be demonstrated inside a five-minute demo unless the clock
 * can be moved. Retrofitting that later would mean touching every engine, so it
 * exists from the first commit.
 *
 * The offset is persisted rather than held only in memory so that a demo
 * survives a server restart part-way through.
 */

/** Real wall-clock time. Deliberately private to this module. */
function systemNow(): Date {
  return new Date();
}

const CLOCK_ROW_ID = 1;

/**
 * In-process cache of the persisted offset. Reads are synchronous because
 * `currentBusinessTime()` is called from everywhere, including pure code paths
 * that have no business awaiting a database round-trip.
 */
let cachedOffsetMs = 0n;
let cacheLoaded = false;

/** Milliseconds currently added to wall-clock time. */
export function getClockOffsetMs(): bigint {
  return cachedOffsetMs;
}

/** True once the offset has been read from the database at least once. */
export function isClockLoaded(): boolean {
  return cacheLoaded;
}

/**
 * The current business time. Synchronous by design.
 *
 * If the offset has not yet been loaded this returns wall-clock time, which is
 * correct for the default (zero-offset) case. Call `refreshClockOffset()` at
 * process start, and after any mutation, to keep the cache honest.
 */
export function currentBusinessTime(): Date {
  const real = systemNow().getTime();
  return new Date(real + Number(cachedOffsetMs));
}

/** Load the persisted offset into the in-process cache. */
export async function refreshClockOffset(): Promise<bigint> {
  const row = await prisma.clockOffset.findUnique({ where: { id: CLOCK_ROW_ID } });
  cachedOffsetMs = row?.offsetMs ?? 0n;
  cacheLoaded = true;
  return cachedOffsetMs;
}

/** Set the offset to an absolute number of milliseconds. */
export async function setClockOffsetMs(
  offsetMs: bigint,
  updatedByEmail?: string,
): Promise<bigint> {
  const now = new Date(systemNow().getTime() + Number(offsetMs));
  await prisma.clockOffset.upsert({
    where: { id: CLOCK_ROW_ID },
    create: { id: CLOCK_ROW_ID, offsetMs, updatedAt: now, updatedByEmail },
    update: { offsetMs, updatedAt: now, updatedByEmail },
  });
  cachedOffsetMs = offsetMs;
  cacheLoaded = true;
  return cachedOffsetMs;
}

/** Move the clock forward (or back, with a negative value) by a duration. */
export async function advanceClock(
  duration: { days?: number; hours?: number; minutes?: number; ms?: number },
  updatedByEmail?: string,
): Promise<Date> {
  const delta =
    BigInt(Math.trunc(duration.ms ?? 0)) +
    BigInt(Math.trunc(duration.minutes ?? 0)) * 60_000n +
    BigInt(Math.trunc(duration.hours ?? 0)) * 3_600_000n +
    BigInt(Math.trunc(duration.days ?? 0)) * 86_400_000n;
  await setClockOffsetMs(cachedOffsetMs + delta, updatedByEmail);
  return currentBusinessTime();
}

/** Return the clock to real time. */
export async function resetClock(updatedByEmail?: string): Promise<void> {
  await setClockOffsetMs(0n, updatedByEmail);
}

/**
 * Test-only: set the cache without touching the database, so unit tests can
 * pin time without a live Postgres.
 */
export function __setCachedOffsetForTests(offsetMs: bigint): void {
  cachedOffsetMs = offsetMs;
  cacheLoaded = true;
}
