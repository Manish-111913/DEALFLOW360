import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  advanceClock,
  currentBusinessTime,
  getClockOffsetMs,
  refreshClockOffset,
  resetClock,
  setClockOffsetMs,
} from "./clock";
import { prisma } from "./db";

afterEach(async () => {
  await resetClock("test");
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("D3 — the application clock", () => {
  it("defaults to a zero offset", async () => {
    await refreshClockOffset();
    expect(getClockOffsetMs()).toBe(0n);
  });

  it("shifts business time by the configured offset", async () => {
    const before = currentBusinessTime().getTime();
    await setClockOffsetMs(86_400_000n, "test"); // one day
    const after = currentBusinessTime().getTime();

    // Allow a little slack for real time elapsing between the two reads.
    expect(after - before).toBeGreaterThanOrEqual(86_400_000 - 5_000);
    expect(after - before).toBeLessThan(86_400_000 + 5_000);
  });

  it("advances by a duration, cumulatively", async () => {
    await setClockOffsetMs(0n, "test");
    await advanceClock({ days: 5 }, "test");
    expect(getClockOffsetMs()).toBe(432_000_000n);

    await advanceClock({ hours: 12 }, "test");
    expect(getClockOffsetMs()).toBe(432_000_000n + 43_200_000n);
  });

  it("moves backwards with a negative duration", async () => {
    await setClockOffsetMs(0n, "test");
    await advanceClock({ days: -2 }, "test");
    expect(getClockOffsetMs()).toBe(-172_800_000n);
  });

  // Persistence is the point: a demo that restarts mid-run must not silently
  // snap back to real time.
  it("survives a cache reload from the database", async () => {
    await setClockOffsetMs(123_456n, "test");
    const reloaded = await refreshClockOffset();
    expect(reloaded).toBe(123_456n);
  });

  it("returns to real time on reset", async () => {
    await advanceClock({ days: 3 }, "test");
    await resetClock("test");
    expect(getClockOffsetMs()).toBe(0n);
  });
});
