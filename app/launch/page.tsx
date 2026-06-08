import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

// Post-login role router. signIn redirects here after a successful sign-in.
// Uses ONE Supabase client for both auth and the role lookups so the queries
// run in the same authenticated context as getUser — a second client instance
// came back empty, which is why role routing failed when done inside signIn.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function Launch() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: pa }, { data: staff }] = await Promise.all([
    supabase.from('platform_admins').select('id').eq('user_id', user.id).eq('is_active', true).maybeSingle(),
    supabase.from('gym_staff_links').select('role').eq('user_id', user.id).eq('is_active', true).maybeSingle(),
  ]);

  if (pa) redirect('/superadmin');
  if (staff) redirect((staff as { role: string }).role === 'instructor' ? '/coach' : '/admin');
  redirect('/dashboard');
}
