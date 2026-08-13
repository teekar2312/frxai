import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: true,
  // Production optimizations
  poweredByHeader: false,
  compress: true,
  // Image optimization
  images: {
    formats: ['image/avif', 'image/webp'],
    },
};

export default nextConfig;
