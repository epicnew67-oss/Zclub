import type { NextConfig } from "next";

/**
 * StripClub next config — security headers + small build tweaks.
 *
 * CSP is environment-aware:
 *   - Development allows the local Supabase stack (127.0.0.1 /
 *     localhost on :54321, http + ws) and React's dev-mode `eval`
 *     (React uses eval() in development for debugging features like
 *     callstack reconstruction; it is never used in production).
 *   - Production allows only the real Supabase origin derived from
 *     NEXT_PUBLIC_SUPABASE_URL (https + wss) — no wildcard connect-src.
 *   - LiveKit origins are derived from LIVEKIT_URL when present, with
 *     the *.livekit.cloud pattern kept as a fallback for hosted deploys.
 *   - NOWPayments IPN is server-to-server, so no client endpoint needed.
 */

const isDev = process.env.NODE_ENV !== "production";

function toConnectOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const url = new URL(raw);
    const wsProtocol = url.protocol === "https:" ? "wss:" : "ws:";
    return [`${url.protocol}//${url.host}`, `${wsProtocol}//${url.host}`];
  } catch {
    return [];
  }
}

const supabaseConnect = new Set<string>(
  toConnectOrigins(process.env.NEXT_PUBLIC_SUPABASE_URL)
);
if (isDev) {
  // Explicit local stack allowances — the browser app runs on
  // localhost:3000 and the local Supabase API on :54321.
  for (const origin of [
    "http://127.0.0.1:54321",
    "http://localhost:54321",
    "ws://127.0.0.1:54321",
    "ws://localhost:54321",
  ]) {
    supabaseConnect.add(origin);
  }
}

const livekitConnect = new Set<string>(toConnectOrigins(process.env.LIVEKIT_URL));
livekitConnect.add("https://*.livekit.cloud");
livekitConnect.add("wss://*.livekit.cloud");

const connectSrc = [
  "'self'",
  ...supabaseConnect,
  ...livekitConnect,
  "https://challenges.cloudflare.com",
].join(" ");

const scriptSrc = isDev
  ? // 'unsafe-eval' is required by React dev mode (callstack
    // reconstruction). Never shipped in production.
    "'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com"
  : "'self' 'unsafe-inline' https://challenges.cloudflare.com";

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `script-src ${scriptSrc}`,
      // 'unsafe-inline' styles are required by Tailwind v4 + the inline
      // <style> block that BrandStyle injects. We cannot nonce these
      // without restructuring the brand system; revisit if a stricter
      // policy is needed.
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob:",
      `connect-src ${connectSrc}`,
      "frame-src 'self' https://challenges.cloudflare.com",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; "),
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: [
      "camera=(self)",
      "microphone=(self)",
      "display-capture=(self)",
      "geolocation=()",
      "payment=()",
      "usb=()",
    ].join(", "),
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
