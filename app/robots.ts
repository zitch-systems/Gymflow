import type { MetadataRoute } from 'next';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://gymflow.ng';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        // Marketing routes are crawlable. Tenant subdomains and auth-gated
        // portals must not be indexed — they're per-user views with no SEO
        // value and would dilute crawl budget across thousands of subdomains.
        allow: ['/', '/features', '/pricing', '/about', '/signup'],
        disallow: [
          '/dashboard',
          '/admin',
          '/coach',
          '/superadmin',
          '/checkin',
          '/classes',
          '/cards',
          '/login',
          '/join',
          '/gym/',
          '/api/',
          '/offline',
        ],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
