import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Statically-typed routes: every <Link href> / router target is checked
  // against the real route tree at build time. All linked routes now exist.
  typedRoutes: true,
  // Tree-shake lucide-react per-route so pages only ship the icons they use.
  experimental: { optimizePackageImports: ['lucide-react'] },

  // Serve modern formats and allow optimizing the per-gym images hosted on
  // Supabase storage (gym logos / hero / equipment photos).
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [{ protocol: 'https', hostname: '*.supabase.co' }],
  },

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
          // Allow the camera for our own origin so the member QR check-in
          // scanner can request it (camera=() blocks getUserMedia outright,
          // before any permission prompt can appear). Mic stays disabled — unused.
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self)' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
    ];
  },
};

export default config;
