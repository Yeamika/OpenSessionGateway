import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);

const nextConfig: NextConfig = {
  experimental: {
    externalDir: true,
  },
  turbopack: {
    root: path.resolve(currentDir, ".."),
  },
  transpilePackages: ["@opensessiongateway/protocol-library"],
};

export default nextConfig;
