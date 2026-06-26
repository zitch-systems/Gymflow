import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Statically-typed routes: every <Link href> / router target is checked
  // against the real route tree at build time. All linked routes now exist.
  typedRoutes: true,

  // Baseline security headers applied to every response. Deliberately no strict
  // Content-Security-Policy yet — the design system leans heavily on inline
  // styles, so a CSP needs nonce wiring + testing before it can be turned on
  // without breaking pages. These headers are safe to ship as-is.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
    ];
  },
};

export default config;
