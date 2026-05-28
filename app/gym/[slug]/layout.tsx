import type { Metadata } from 'next';

// Tenant subdomains/routes are per-gym shells with no SEO value, and there are
// thousands of them — letting search engines crawl them would dilute crawl
// budget across near-identical pages and risk a duplicate-content penalty on
// the apex marketing pages. Apply noindex at the route-group root so every
// child page inherits it (admin / dashboard / coach / login / join / classes
// / checkin), plus apex search engines via robots.ts.
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function GymTenantLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
