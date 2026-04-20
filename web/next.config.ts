import type { NextConfig } from "next";

const gatewayOrigin = process.env.OSG_GATEWAY_ORIGIN || process.env.NEXT_PUBLIC_OSG_GATEWAY_ORIGIN || "http://127.0.0.1:4088";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${gatewayOrigin}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
