import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@stock-market/auth", "@stock-market/db"],
};

export default nextConfig;
