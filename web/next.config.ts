import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, ".."),
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
};

export default nextConfig;
