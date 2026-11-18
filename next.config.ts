import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Next's own gzip can hold back the last chunk of a streamed reply, so a save sometimes didn't show until the next click.
  // Railway's edge compresses responses anyway.
  compress: false,
  // 26mb: lease documents, floor plans and concept images are uploaded through server actions (25 MB per file max).
  experimental: { serverActions: { bodySizeLimit: "26mb", allowedOrigins: ["localhost:3100", "127.0.0.1:3100", "*.trycloudflare.com"] } },
};
export default nextConfig;
