import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

const nextConfig = (phase: string): NextConfig => ({
  // Keep production builds from replacing the running dev server's bundles.
  distDir: process.env.STOCK_MARKET_NEXT_DIST || (phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next"),
  transpilePackages: ["@stock-market/auth", "@stock-market/db", "@stock-market/ui"],
});

export default nextConfig;
