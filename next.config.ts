import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Statically-typed routes: every <Link href> / router target is checked
  // against the real route tree at build time. All linked routes now exist.
  typedRoutes: true,
  // Tree-shake lucide-react per-route so pages only ship the icons they use.
  // bodySizeLimit lifts the 1 MB default on Server Action payloads: equipment
  // photos and gym logos are validated up to 2 MB before upload, but the action
  // request itself was rejected at 1 MB ("Body exceeded 1 MB limit"), so a valid
  // 1–2 MB photo failed to save. 3 MB covers a 2 MB file plus multipart/form
  // overhead.
  experimental: {
    optimizePackageImports: ['lucide-react'],
    serverActions: { bodySizeLimit: '3mb' },
  },

  // Serve modern formats and allow optimizing the per-gym images hosted on
  // Supabase storage (gym logos / hero / equipment photos).
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [{ protocol: 'https', hostname: '*.supabase.co' }],
  },

  // Baseline security headers applied to every response. The strict
  // Content-Security-Policy ships REPORT-ONLY first: the design system leans
  // heavily on inline styles/scripts and gym landings load tenant-configured
  // third parties (GA4, Meta pixel, Crisp/Tawk chat), so enforcement without a
  // violation-observation phase would break pages silently. Violations report
  // to Sentry's CSP endpoint when SENTRY_DSN is set (console-only otherwise).
  // Once the report stream is quiet, rename the header to
  // Content-Security-Policy to enforce.
  async headers() {
    // https://<key>@<host>/<project> → https://<host>/api/<project>/security/?sentry_key=<key>
    let reportUri = '';
    try {
      const dsn = process.env.SENTRY_DSN;
      if (dsn) {
        const u = new URL(dsn);
        const project = u.pathname.replace(/^\//, '');
        if (u.username && project) reportUri = `; report-uri ${u.protocol}//${u.host}/api/${project}/security/?sentry_key=${u.username}`;
      }
    } catch { /* malformed DSN — report to console only */ }
    const csp = [
      "default-src 'self'",
      // 'unsafe-inline'/'unsafe-eval' reflect today's reality (inline styles,
      // Next inline bootstrap, tenant tracker snippets) — the report phase
      // exists to shrink these before enforcement.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.google-analytics.com https://connect.facebook.net https://client.crisp.chat https://embed.tawk.to https://*.tawk.to",
      "style-src 'self' 'unsafe-inline' https://client.crisp.chat https://*.tawk.to https://fonts.googleapis.com",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https://fonts.gstatic.com https://client.crisp.chat https://*.tawk.to",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://www.google-analytics.com https://*.facebook.com https://client.crisp.chat wss://client.relay.crisp.chat https://*.tawk.to wss://*.tawk.to",
      "frame-src 'self' https://*.tawk.to",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ') + reportUri;
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Allow the camera for our own origin so the member QR check-in
          // scanner can request it (camera=() blocks getUserMedia outright,
          // before any permission prompt can appear). Mic stays disabled — unused.
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self)' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'Content-Security-Policy-Report-Only', value: csp },
        ],
      },
    ];
  },
};

export default config;
