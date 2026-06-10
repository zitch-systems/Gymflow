import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { provisionOwner } from '@/lib/provision';
import { FinishSetup } from './finish-setup';

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

  const [{ data: pa }, { data: staff }, { data: member }] = await Promise.all([
    supabase.from('platform_admins').select('id').eq('user_id', user.id).eq('is_active', true).maybeSingle(),
    supabase.from('gym_staff_links').select('role').eq('user_id', user.id).eq('is_active', true).maybeSingle(),
    supabase.from('gym_member_links').select('id').eq('user_id', user.id).eq('is_active', true).limit(1).maybeSingle(),
  ]);

  if (pa) redirect('/superadmin');
  if (staff) redirect((staff as { role: string }).role === 'instructor' ? '/coach' : '/admin');
  if (member) redirect('/dashboard');

  // No role anywhere: an account that signed up before provisioning existed
  // (or whose provisioning failed). Previously this fell through to /dashboard,
  // whose gate bounced back to /login — an infinite loop with no explanation.
  // Heal it: provision from the signup's gym_name breadcrumb, or ask for the
  // gym name with a one-field form.
  const gymName = String((user.user_metadata as Record<string, unknown> | null)?.gym_name ?? '').trim();
  if (gymName) {
    const prov = await provisionOwner({ userId: user.id, email: user.email ?? '', gymName });
    if (prov.ok) redirect('/admin');
  }

  return <FinishSetup defaultGymName={gymName} />;
}
