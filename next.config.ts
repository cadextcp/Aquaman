import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker: minimal runtime node_modules (TechDesign §3, AGENTS gotcha)
  output: "standalone",
  // Native modules must stay external — bundler must not pack them
  serverExternalPackages: ["better-sqlite3", "sharp"], // sharp: Phase 2 photo uploads
  experimental: {
    serverActions: {
      // Photo uploads up to 5 MB (Next default would silently fail at 1 MB)
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
