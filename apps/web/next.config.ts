import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.STOCK_MARKET_NEXT_DIST || ".next",
  transpilePackages: ["@stock-market/auth", "@stock-market/db"],
};

export default nextConfig;
