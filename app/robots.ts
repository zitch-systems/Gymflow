import type { MetadataRoute } from 'next';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://gymflow.ng';

// Allow crawling of the public marketing pages; keep the authenticated app
// surfaces and API routes out of the index.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/coach', '/superadmin', '/dashboard', '/checkin', '/classes', '/launch', '/api', '/join'],
    },
    sitemap: `${SITE}/sitemap.xml`,
  };
}
