import { execSync } from "node:child_process";
import { config } from "dotenv";
import { Client } from "pg";

/**
 * Builds a throwaway database for the test run.
 *
 * The suite is an integration suite — it exercises real constraints, real
 * triggers and a real hash chain, which is the point. What it must not do is
 * run against the development database:
 *
 *   - Tests would depend on someone having seeded it first, so `npm test` on a
 *     fresh clone (or in CI) would fail for reasons unrelated to the code.
 *   - Every run leaves users, customers and audit rows behind, growing without
 *     bound and slowly changing what the next run sees.
 *
 * Reset is by DROP/CREATE rather than TRUNCATE because D19's trigger refuses to
 * truncate AuditLog — correctly. The constraint rules out the shortcut, so the
 * cleaner approach is the only one available.
 */

config({ path: "../.env" });

function testDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  if (explicit) return explicit;

  const dev = process.env.DATABASE_URL;
  if (!dev) {
    throw new Error("Neither TEST_DATABASE_URL nor DATABASE_URL is set. Copy .env.example to .env.");
  }
  // Derive a sibling database so a missing TEST_DATABASE_URL still cannot point
  // the suite at development data.
  const url = new URL(dev);
  url.pathname = `${url.pathname.replace(/\/$/, "")}_test`;
  return url.toString();
}

export default async function setup(): Promise<void> {
  const testUrl = testDatabaseUrl();
  const parsed = new URL(testUrl);
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, "").split("?")[0]);

  if (!dbName || dbName === "postgres") {
    throw new Error(`Refusing to use "${dbName}" as a test database.`);
  }

  // This function issues DROP DATABASE. A misconfigured TEST_DATABASE_URL must
  // not be able to aim that at development data, so the two are compared by
  // resolved database name rather than trusting the strings to differ.
  const devUrl = process.env.DATABASE_URL;
  if (devUrl) {
    const devName = decodeURIComponent(
      new URL(devUrl).pathname.replace(/^\//, "").split("?")[0],
    );
    if (devName === dbName) {
      throw new Error(
        `TEST_DATABASE_URL points at "${dbName}", which is also DATABASE_URL. ` +
          `The test database is dropped on every run; refusing to continue.`,
      );
    }
  }

  // Connect to the maintenance database to drop and recreate the test one.
  const adminUrl = new URL(testUrl);
  adminUrl.pathname = "/postgres";
  adminUrl.search = "";

  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    // FORCE closes any connection a previous crashed run left open.
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }

  // dotenv does not override variables already present, so prisma7.config.ts
  // reading ../.env cannot clobber this.
  const childEnv = { ...process.env, DATABASE_URL: testUrl };

  execSync("npx prisma migrate deploy", { env: childEnv, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts", { env: childEnv, stdio: "pipe" });
}
