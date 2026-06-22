import type { MetadataRoute } from 'next';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://gymflow.ng';

// Public marketing routes only — the authenticated app surfaces are excluded
// from the index (see robots.ts).
const PUBLIC_PATHS = ['', '/features', '/about', '/pricing', '/contact', '/careers', '/legal', '/gallery'];

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.map((path) => ({
    url: `${SITE}${path}`,
    changeFrequency: 'weekly',
    priority: path === '' ? 1 : 0.7,
  }));
}
