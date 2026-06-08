import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/auth/dal';

// Post-login role router. signIn redirects here after a successful sign-in.
//
// Why this exists: the role lookup must run on a request where the user's auth
// cookie is attached. Inside the signIn Server Action the freshly-created
// session isn't yet applied to follow-up PostgREST queries, so they execute as
// the `anon` role — and RLS's "read your own row" policies
// (gym_staff_links_select_own, pa_select_self) require auth.uid(), so they
// returned nothing. That sent every staff/admin account to /dashboard, which
// then bounced to /login. Here, on a fresh request, the cookie session is in
// effect, so the same queries run as the signed-in user and resolve correctly.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function Launch() {
  const user = await requireAuth();
  const supabase = await createClient();

  const [{ data: pa }, { data: staff }] = await Promise.all([
    supabase.from('platform_admins').select('id').eq('user_id', user.id).eq('is_active', true).maybeSingle(),
    supabase.from('gym_staff_links').select('role').eq('user_id', user.id).eq('is_active', true).maybeSingle(),
  ]);

  if (pa) redirect('/superadmin');
  if (staff) redirect((staff as { role: string }).role === 'instructor' ? '/coach' : '/admin');
  redirect('/dashboard');
}
