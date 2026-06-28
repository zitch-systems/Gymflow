import type { MetadataRoute } from 'next';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://gymflow.ng';

// Public marketing routes only — the authenticated app surfaces are excluded
// from the index (see robots.ts).
const PUBLIC_PATHS = ['', '/features', '/about', '/pricing', '/contact', '/careers', '/legal', '/gallery'];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return PUBLIC_PATHS.map((path) => ({
    url: `${SITE}${path}`,
    // Google largely ignores changeFrequency/priority but does use lastModified.
    lastModified,
    changeFrequency: 'weekly',
    priority: path === '' ? 1 : 0.7,
  }));
}
