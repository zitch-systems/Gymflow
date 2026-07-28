import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { gymSlugFromHost } from '@/lib/tenant';
import { LoginClient, type LoginNotice, type LoginGym } from './login-client';

export const metadata = {
  title: 'Sign in',
  description: 'Sign in to your GymFlow dashboard, or launch your gym in an afternoon.',
};

// The signIn server action runs in this route's function and makes Supabase
// auth + role-lookup network calls. A free-tier Supabase project that has
// auto-paused takes longer than the platform's default ~10s to resume, which
// surfaces as a 504 on the first login. Widen the budget so the resume
// completes and the login succeeds instead of timing out.
export const maxDuration = 60;

// This route is host-agnostic (middleware only rewrites `/`), so on a gym
// subdomain it must read the host itself to render the gym-branded member
// sign-in instead of the platform (owner) login.
export const dynamic = 'force-dynamic';

// Load the branding for a gym subdomain, so <slug>.gymflow.ng/login is the
// gym's own sign-in — logo, colour, and a Join link — not the platform login.
async function loadGym(slug: string): Promise<LoginGym | null> {
  const cols = 'name, slug, logo_url, tagline, brand_color';
  try {
    const admin = createAdminClient();
    const { data } = await admin.from('gyms').select(cols).eq('slug', slug).maybeSingle();
    return (data as unknown as LoginGym) ?? null;
  } catch {
    const supabase = await createClient();
    const { data } = await supabase.from('gyms').select(cols).eq('slug', slug).maybeSingle();
    return (data as unknown as LoginGym) ?? null;
  }
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  // Post-action notices (signup → check-email, confirm link → confirmed,
  // password reset → reset, expired/used auth link → link-expired). Previously
  // these params were silently ignored, so /auth/confirm's ?error=link_expired
  // landed on a normal login page with no explanation.
  const notice: LoginNotice = sp['check-email'] ? 'check-email'
    : sp.confirmed ? 'confirmed'
    : sp.reset ? 'reset'
    : sp.error === 'link_expired' ? 'link-expired'
    : null;

  const slug = gymSlugFromHost((await headers()).get('host'));
  const gym = slug ? await loadGym(slug) : null;

  return <LoginClient initialMode="in" notice={notice} gym={gym} />;
}
