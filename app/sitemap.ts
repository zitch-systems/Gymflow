import type { MetadataRoute } from 'next';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://gymflow.ng';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE}/`,         lastModified: now, changeFrequency: 'weekly',  priority: 1.0 },
    { url: `${SITE}/features`, lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE}/pricing`,  lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE}/about`,    lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE}/signup`,   lastModified: now, changeFrequency: 'yearly',  priority: 0.6 },
  ];
}
