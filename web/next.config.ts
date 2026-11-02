import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";
import path from "node:path";

// All settings live in one file, .env at the repository root, shared with the API. The website runs from web/.
// Next has already looked in web/ and keeps that result, so the root file is loaded with a forced reload.
loadEnvConfig(path.join(process.cwd(), ".."), process.env.NODE_ENV !== "production", undefined, true);

const apiUrl = process.env.API_URL || "http://127.0.0.1:4100";

const nextConfig: NextConfig = {
  // The API accepts one file of up to 10 MB. The proxy must let that file and its upload wrapper through, or the visitor gets no answer.
  experimental: { proxyTimeout: 120_000, proxyClientMaxBodySize: "12mb" },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      { source: "/login/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "no-store" }] },
      { source: "/logs", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default nextConfig;
