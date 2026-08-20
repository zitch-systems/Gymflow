import type { MetadataRoute } from 'next';

import { SITE_URL as SITE } from '@/lib/site-url';

// Allow crawling of the public marketing pages; keep the authenticated app
// surfaces and API routes out of the index.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // The platform console is deliberately absent. robots.txt is public, so
      // listing a path here announces it — and the console's path is now the
      // secret (SUPERADMIN_PATH, see lib/superadmin-path.ts). Nothing links to
      // it, so there is no crawl path to it; the retired /superadmin URL 404s
      // like any other non-existent path, so it needs no entry either.
      disallow: ['/admin', '/coach', '/dashboard', '/checkin', '/classes', '/launch', '/api', '/join', '/login', '/signup', '/forgot-password', '/reset-password', '/billing', '/offline'],
    },
    sitemap: `${SITE}/sitemap.xml`,
  };
}
