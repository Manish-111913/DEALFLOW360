import { config } from "dotenv";
import type { NextConfig } from "next";

// One .env at the repo root, shared by both workspaces.
config({ path: "../.env" });

const nextConfig: NextConfig = {
  // @dealflow/backend ships TypeScript source rather than a build artifact, so
  // there is no build step between the two packages.
  transpilePackages: ["@dealflow/backend"],
};

export default nextConfig;
