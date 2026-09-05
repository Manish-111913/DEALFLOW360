import { config } from "dotenv";
import { defineConfig } from "vitest/config";

config({ path: "../.env" });

/**
 * Tests always run against a dedicated database, never the development one.
 * vitest.globalSetup.ts drops and rebuilds it before the suite.
 */
function testDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  if (explicit) return explicit;
  const dev = process.env.DATABASE_URL ?? "";
  if (!dev) return "";
  const url = new URL(dev);
  url.pathname = `${url.pathname.replace(/\/$/, "")}_test`;
  return url.toString();
}

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./vitest.globalSetup.ts"],
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // These suites share one database and a global clock offset, so files run
    // one at a time. Parallelism here would produce flakes, not speed.
    fileParallelism: false,
    // Overrides whatever .env holds, so a stray DATABASE_URL cannot point the
    // suite at development data.
    env: { DATABASE_URL: testDatabaseUrl() },
  },
});
