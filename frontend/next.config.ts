import { config } from "dotenv";
import type { NextConfig } from "next";

// One .env at the repo root, shared by both workspaces.
config({ path: "../.env" });

/**
 * The build directory, per surface.
 *
 * DealFlow360 runs the same application twice - the staff workspace and the
 * customer portal - and `next dev` takes a lock on its build directory,
 * refusing to start a second server that would share one ("Another next dev
 * server is already running"). Giving each surface its own directory lets both
 * run at once from a single checkout.
 *
 * Unset means one server serving everything, which keeps `npm run dev` working
 * exactly as before and reuses the `.next` cache already on disk.
 */
function distDir(): string {
  const surface = process.env.DEALFLOW_SURFACE?.trim().toLowerCase();
  return surface === "portal" || surface === "internal" ? `.next-${surface}` : ".next";
}

const nextConfig: NextConfig = {
  // @dealflow/backend ships TypeScript source rather than a build artifact, so
  // there is no build step between the two packages.
  transpilePackages: ["@dealflow/backend"],
  distDir: distDir(),
};

export default nextConfig;
