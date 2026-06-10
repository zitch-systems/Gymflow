import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { JoinClient } from './join-client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return { title: `Join ${slug}`, description: 'Create your member account and start training.' };
}

// Public gym invite link — the way real members get accounts. Staff share
// /join/<slug> (admin members toolbar, member referral share); a new member
// signs up here and lands on /dashboard linked to this gym.
export default async function JoinPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

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

  return <JoinClient slug={slug} gymName={gym.name} logoUrl={gym.logo_url} currentEmail={user?.email ?? null} />;
}
