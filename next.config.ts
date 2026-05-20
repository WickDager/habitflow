import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  images: {
    remotePatterns: [{ hostname: "t.me" }],
  },
};

export default nextConfig;
