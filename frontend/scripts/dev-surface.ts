import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import type { Readable } from "node:stream";

/**
 * Start one or both of DealFlow360's surfaces.
 *
 *   node scripts/dev-surface.mjs internal   -> staff workspace on :3001
 *   node scripts/dev-surface.mjs portal     -> customer portal on :3000
 *   node scripts/dev-surface.mjs both       -> both, in one terminal
 *
 * A launcher rather than `DEALFLOW_SURFACE=portal next dev` in the npm script,
 * because that syntax is a Unix shell feature and npm runs scripts through
 * cmd.exe on Windows, where it is a syntax error. This is the same idea as
 * cross-env without taking the dependency.
 *
 * TypeScript like everything else in this repository, run through tsx.
 *
 * Both processes read the same DATABASE_URL and import the same business core.
 * They are two clients of one system; nothing here gives either its own data.
 */

/**
 * Resolved rather than assembled from a relative path: this is an npm
 * workspace, so `next` is hoisted to the root node_modules and is not where a
 * path relative to this file would look for it.
 */
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");

type SurfaceName = "internal" | "portal";

interface SurfaceConfig {
  port: number;
  /** Padded so the interleaved output of `both` lines up. */
  label: string;
}

const SURFACES: Record<SurfaceName, SurfaceConfig> = {
  internal: { port: 3001, label: "internal" },
  portal: { port: 3000, label: "portal  " },
};

/**
 * Declared before `start`, which closes over it: an exiting child has to be
 * able to reach its siblings to stop them.
 */
let children: ChildProcess[] = [];

function start({ surface, port, label }: SurfaceConfig & { surface: SurfaceName }): ChildProcess {
  const child = spawn(
    process.execPath,
    [nextBin, "dev", "--port", String(port)],
    {
      env: { ...process.env, DEALFLOW_SURFACE: surface },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  // Prefix every line, so `both` is readable in one terminal.
  const tag = (stream: Readable | null, target: NodeJS.WriteStream) => {
    if (!stream) return;
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) target.write(`[${label}] ${line}\n`);
    });
  };
  tag(child.stdout, process.stdout);
  tag(child.stderr, process.stderr);

  child.on("exit", (code) => {
    process.stdout.write(`[${label}] exited with code ${code}\n`);
    process.exitCode = code ?? 0;
    // One surface going down takes the other with it. Otherwise the survivor
    // is orphaned still holding its port, and the next `dev:both` fails with
    // "address already in use" - pointing at a process nobody knows they are
    // running. Better to stop cleanly and be restarted.
    stopAll();
  });

  return child;
}

/** Idempotent, because it is reachable from a signal and from a child exit. */
let stopping = false;

function stopAll(signal: NodeJS.Signals = "SIGTERM"): void {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill(signal);
  }
}

const requested = process.argv[2] ?? "both";
const wanted =
  requested === "both" ? Object.keys(SURFACES) : [requested];

for (const name of wanted) {
  if (!SURFACES[name]) {
    process.stderr.write(`Unknown surface "${name}". Use internal, portal or both.\n`);
    process.exit(1);
  }
}

children = wanted.map((name) => start({ surface: name, ...SURFACES[name] }));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => stopAll(signal));
}

process.stdout.write(
  wanted.map((n) => `${n} -> http://localhost:${SURFACES[n].port}`).join("\n") + "\n",
);
