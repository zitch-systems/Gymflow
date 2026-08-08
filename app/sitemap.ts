import type { MetadataRoute } from 'next';
import { ROOT_DOMAIN } from '@/lib/tenant';
import { OFFLINE_GYM_FILTER } from '@/lib/gym-status';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://gymflow.ng';

// Public marketing routes only — the authenticated app surfaces are excluded
// from the index (see robots.ts).
const PUBLIC_PATHS = ['', '/features', '/about', '/pricing', '/contact', '/careers', '/legal', '/gallery'];

// Re-query hourly so newly-launched gym landings enter the index without a
// redeploy (the gym set changes far more often than the marketing routes).
export const revalidate = 3600;

// Prefer the service-role client so this works regardless of gyms RLS, but the
// gyms_select policy is `using (true)` (public), so the anon client is a fine
// fallback. Import lazily so a missing service-role key can't break the module.
async function getClient() {
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    return createAdminClient();
  } catch {
    const { createClient } = await import('@/lib/supabase/server');
    return await createClient();
  }
}

// Each gym with a public landing is reachable at its own subdomain — the same
// canonical the landing page emits. Enumerate them so search engines discover
// every tenant, not just the marketing pages. Best-effort: if the DB is
// unreachable (e.g. a build with placeholder env), fall back to marketing only.
async function gymEntries(): Promise<MetadataRoute.Sitemap> {
  try {
    const db = await getClient();
    const { data } = await db
      .from('gyms')
      .select('slug, updated_at')
      .eq('landing_enabled', true)
      // Suspending a gym does not clear landing_enabled, so without this the
      // sitemap kept handing crawlers the URL of a tenant whose landing page
      // now 404s — a soft 404 we generate for ourselves.
      .not('status', 'in', OFFLINE_GYM_FILTER)
      .not('slug', 'is', null)
      .limit(5000);
    return (data ?? [])
      .filter((g): g is { slug: string; updated_at: string | null } => Boolean(g.slug))
      .map((g) => ({
        url: `https://${g.slug}.${ROOT_DOMAIN}/`,
        lastModified: g.updated_at ? new Date(g.updated_at) : undefined,
        changeFrequency: 'weekly' as const,
        priority: 0.6,
      }));
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date();
  const marketing: MetadataRoute.Sitemap = PUBLIC_PATHS.map((path) => ({
    url: `${SITE}${path}`,
    // Google largely ignores changeFrequency/priority but does use lastModified.
    lastModified,
    changeFrequency: 'weekly',
    priority: path === '' ? 1 : 0.7,
  }));
  return [...marketing, ...(await gymEntries())];
}
