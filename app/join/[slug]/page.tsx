import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { JoinClient } from './join-client';

// Plan ids arrive from a query string — validate the shape before it reaches a
// query, the same guard the admin member actions use.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return { title: `Join ${slug}`, description: 'Create your member account and start training.' };
}

// Public gym invite link — the way real members get accounts. Staff share
// /join/<slug> (admin members toolbar, member referral share); a new member
// signs up here and lands on /dashboard linked to this gym.
export default async function JoinPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const planId = typeof sp.plan === 'string' ? sp.plan : null;

  // gyms are publicly readable, but prefer the admin client so the page also
  // works if that RLS ever tightens.
  let gym: { id: string; name: string; logo_url: string | null } | null = null;
  try {
    const admin = createAdminClient();
    const { data } = await admin.from('gyms').select('id, name, logo_url').eq('slug', slug).maybeSingle();
    gym = data ?? null;
  } catch {
    const supabase = await createClient();
    const { data } = await supabase.from('gyms').select('id, name, logo_url').eq('slug', slug).maybeSingle();
    gym = data ?? null;
  }
  if (!gym) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // A plan chosen on the landing page ("Choose Gold") used to be dropped on the
  // way here, so every plan button led to an identical screen. Look it up and
  // show it back — scoped to THIS gym and to active plans, so a hand-edited id
  // can't surface another gym's pricing.
  let plan: { name: string; price: number | null; duration_months: number | null } | null = null;
  if (planId && UUID_RE.test(planId)) {
    try {
      const admin = createAdminClient();
      const { data } = await admin
        .from('membership_plans')
        .select('name, price, duration_months')
        .eq('id', planId).eq('gym_id', gym.id).eq('is_active', true)
        .maybeSingle();
      plan = (data as typeof plan) ?? null;
    } catch { /* no service key — the join still works, just without the label */ }
  }

  return <JoinClient slug={slug} gymName={gym.name} logoUrl={gym.logo_url} currentEmail={user?.email ?? null} plan={plan} />;
}
