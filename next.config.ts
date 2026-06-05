import type { NextConfig } from "next";

// Supabase project URL (e.g. https://<id>.supabase.co) needs to be in
// connect-src for REST + wss:// for Realtime. Falls back permissively if the
// env var is absent at build time so prod builds don't fail on bad config.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_HOST = SUPABASE_URL ? new URL(SUPABASE_URL).host : '*.supabase.co';

const CSP = [
  "default-src 'self'",
  // Paystack inline.js + Next runtime + the small theme-init inline script.
  // 'unsafe-inline' kept for App Router compatibility; tighten with nonces later.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.paystack.co",
  // Inline styles ship from React/Next prerender; Google Fonts stylesheet.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  // Gym/member photos may come from any HTTPS source (uploads, third-party CDNs).
  "img-src 'self' data: blob: https:",
  `connect-src 'self' https://${SUPABASE_HOST} wss://${SUPABASE_HOST} https://api.paystack.co https://*.ingest.sentry.io https://us.i.posthog.com https://eu.i.posthog.com https://app.posthog.com`,
  // Paystack inline checkout iframes load from these hosts.
  "frame-src 'self' https://checkout.paystack.com https://standard.paystack.co https://js.paystack.co",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests',
].join('; ');

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CSP },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Camera is needed for the QR scanner on /checkin. Everything else off.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(self), interest-cohort=()' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
];

// A per-deploy build id, baked into the client bundle (NEXT_PUBLIC_BUILD_ID) and
// echoed by /api/version, so a long-lived PWA session can detect a new release
// and reload itself onto the latest UI. Git SHA on Vercel/Cloudflare; a build
// timestamp otherwise — either way it changes every deploy.
const BUILD_ID =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.CF_PAGES_COMMIT_SHA ||
  process.env.GIT_COMMIT_SHA ||
  String(Date.now());

const nextConfig: NextConfig = {
  // Don't advertise the framework in response headers.
  poweredByHeader: false,
  // Exposed to the client for the deploy-aware version watcher (see
  // components/ui/version-watcher.tsx + app/api/version).
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  // Strip console.* (except errors/warnings) from production bundles.
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error', 'warn'] } : false,
  },
  images: {
    // Gym logos and member photos can be uploaded with arbitrary HTTPS sources
    // (Supabase Storage, Cloudinary, owner's existing CDN, etc.). Accept any
    // https origin but never http — img-src CSP also enforces https.
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
    formats: ['image/avif', 'image/webp'],
  },
  async headers() {
    return [
      { source: '/:path*', headers: SECURITY_HEADERS },
    ];
  },
};

export default nextConfig;
