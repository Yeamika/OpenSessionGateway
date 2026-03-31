import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    externalDir: true,
  },
  transpilePackages: ["@opensessiongateway/protocol-library"],
};

export default nextConfig;
