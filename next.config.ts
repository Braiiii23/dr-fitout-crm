import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Next's own gzip can hold back the last chunk of a streamed reply, so a save sometimes didn't show until the next click.
  // Railway's edge compresses responses anyway.
  compress: false,
  experimental: { serverActions: { allowedOrigins: ["localhost:3100", "127.0.0.1:3100", "*.trycloudflare.com"] } },
};
export default nextConfig;
