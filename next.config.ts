import type { NextConfig } from "next";

/**
 * Konfigurasi produksi FINEX AI Trading System.
 *
 * Keamanan:
 *  - poweredByHeader: false     → tidak membocorkan teknologi server
 *  - headers()                   → security headers standar (klikjacking,
 *    MIME-sniffing, referrer, permissions, CSP pragmatis)
 *
 * CSP memakai 'unsafe-inline'/'unsafe-eval' karena Next.js membutuhkannya
 * untuk hydration & Tailwind inline styles — tetap memblokir script/eksternal
 * origin asing. Untuk CSP ketat ber-nonce, lihat PRODUCTION.md.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' ws: wss:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  typescript: {
    // Produksi: build GAGAL bila ada error TypeScript (jangan disembunyikan).
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
