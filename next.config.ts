import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@hashgraph/sdk", "ethers"],
  devIndicators: false,
};

export default nextConfig;
