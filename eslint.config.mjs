import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * D3 is enforced here, not by convention.
 *
 * Only a zero-argument `new Date()` is banned — that is the form that reads the
 * host clock. `new Date(ms)` and `new Date(isoString)` are conversions and stay
 * legal, which matters because timestamps are parsed all over the codebase.
 */
const banSystemClock = [
  "error",
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message:
      "D3: use currentBusinessTime() from @dealflow/backend. A bare new Date() reads the host clock and breaks demo time-travel.",
  },
  {
    selector:
      "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message:
      "D3: use currentBusinessTime() from @dealflow/backend instead of Date.now().",
  },
];

// nextTs is just the TypeScript parser and TS rules, so it applies everywhere —
// without it the backend files have no parser and fail on the first type
// annotation. nextVitals carries the React/Next-specific rules and is scoped to
// the frontend workspace, which is the only place they mean anything.
const frontendRules = nextVitals.map((entry) => ({
  ...entry,
  files: ["frontend/**/*.ts", "frontend/**/*.tsx"],
  settings: { ...entry.settings, next: { rootDir: "frontend" } },
}));

export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "**/.next/**",
    "**/generated/**",
    "**/next-env.d.ts",
  ]),
  ...nextTs,
  ...frontendRules,
  {
    rules: { "no-restricted-syntax": banSystemClock },
  },
  {
    // The single exemption: the clock module is where system time enters.
    files: ["backend/src/clock.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
]);
