import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Structural guards, checked across both workspaces.
 *
 * The ESLint rule already bans host-clock reads, and the backend exposes no
 * audit mutation. Both can be switched off — a rule can be disabled inline, and
 * a new file can import Prisma directly. These tests assert the properties
 * themselves, so disabling the enforcement does not quietly disable the
 * guarantee.
 *
 * This file is excluded from its own scans, since it necessarily contains the
 * patterns it searches for.
 */

// Vitest runs from backend/, so the repo root is one level up.
const ROOT = resolve(process.cwd(), "..");
const SCAN_DIRS = ["backend/src", "backend/prisma", "backend/tests", "frontend/src"];

const EXCLUDED_DIRS = new Set(["node_modules", ".next", "generated", "migrations"]);

/** The single file allowed to read the host clock. */
const CLOCK_EXEMPT = [join("backend", "src", "clock.ts")];
const SELF = join("backend", "tests", "structural.test.ts");

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (EXCLUDED_DIRS.has(entry)) continue;
      collectSourceFiles(full, acc);
    } else if (/\.(ts|tsx|mts)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

const sourceFiles = SCAN_DIRS.flatMap((d) => collectSourceFiles(join(ROOT, d))).map((f) =>
  relative(ROOT, f),
);

function read(file: string): string {
  return readFileSync(join(ROOT, file), "utf8");
}

function isSelf(file: string): boolean {
  return file.split("/").join(sep) === SELF;
}

describe("D3 — the host clock is read in exactly one place", () => {
  it("scans both workspaces", () => {
    expect(sourceFiles.length).toBeGreaterThan(10);
    expect(sourceFiles.some((f) => f.includes("frontend"))).toBe(true);
    expect(sourceFiles.some((f) => f.includes("backend"))).toBe(true);
  });

  it("has no bare new Date() or Date.now() outside the clock module", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles) {
      const normalised = file.split("/").join(sep);
      if (CLOCK_EXEMPT.includes(normalised) || isSelf(file)) continue;

      const contents = read(file);
      // Only the zero-argument form reads the clock; new Date(ms) is a
      // conversion and stays legal, matching the ESLint selector exactly.
      if (/new\s+Date\(\s*\)/.test(contents)) {
        offenders.push(`${file} (bare Date construction)`);
      }
      if (/Date\s*\.\s*now\s*\(/.test(contents)) {
        offenders.push(`${file} (Date.now)`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("D19 — no audit mutation path exists in the codebase", () => {
  it("never calls update, delete or upsert on the audit log", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles) {
      if (isSelf(file)) continue;
      if (/auditLog\s*\.\s*(update|updateMany|delete|deleteMany|upsert)\b/.test(read(file))) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("package boundary", () => {
  // The backend must stay framework-agnostic: plain domain logic over Prisma,
  // runnable from a script or a test with no Next.js present.
  it("keeps Next.js and React out of the backend", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles.filter((f) => f.startsWith("backend"))) {
      if (isSelf(file)) continue;
      if (/from\s+["'](next|next\/[^"']+|react|react-dom)["']/.test(read(file))) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("routes the frontend through the backend's public entry point", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles.filter((f) => f.startsWith("frontend"))) {
      // Reaching past the barrel into internal modules would let the frontend
      // depend on backend internals that are free to change.
      if (/from\s+["']@dealflow\/backend\/[^"']+["']/.test(read(file))) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("D6 — scoped access goes through scopeFor", () => {
  it("exports scopeFor as the single scoping entry point", () => {
    expect(read(join("backend", "src", "authz", "scope.ts"))).toContain(
      "export function scopeFor",
    );
  });

  it("expresses denial as an unsatisfiable filter, not an empty object", () => {
    // Spreading `{}` into a Prisma where clause returns every row, so "no
    // access" must be a filter that matches nothing.
    expect(read(join("backend", "src", "authz", "scope.ts"))).toMatch(
      /DENY_ALL[^=]*=\s*\{\s*id:\s*\{\s*in:/,
    );
  });
});
