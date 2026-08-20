// BreadcrumbList structured data for marketing subpages (Home → Page).
// Values are developer-authored constants — no user input, so no escaping
// concerns (same rationale as the pricing Product LD).

import { SITE_URL } from '@/lib/site-url';

export function BreadcrumbLd({ name, path }: { name: string; path: string }) {
  const ld = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
      { '@type': 'ListItem', position: 2, name, item: `${SITE_URL}${path}` },
    ],
  });
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} />;
}
