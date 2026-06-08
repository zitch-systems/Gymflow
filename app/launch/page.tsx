import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getUser } from '@/lib/auth/dal';

// Post-login role router. signIn redirects here after a successful sign-in.
// (Temporary GFDBG logging is in place to pin down why staff/admin logins
// bounce — it reports whether the session survives to this fresh request and
// what the role lookups return.)
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function Launch() {
  const user = await getUser();
  console.log('GFDBG launch user=' + (user?.id ?? 'NULL'));
  if (!user) redirect('/login');

  const supabase = await createClient();
  const [{ data: pa, error: paErr }, { data: staff, error: staffErr }] = await Promise.all([
    supabase.from('platform_admins').select('id').eq('user_id', user.id).eq('is_active', true).maybeSingle(),
    supabase.from('gym_staff_links').select('role').eq('user_id', user.id).eq('is_active', true).maybeSingle(),
  ]);
  console.log(
    'GFDBG launch pa=' + Boolean(pa) +
    ' staff=' + ((staff as { role?: string } | null)?.role ?? 'none') +
    ' paErr=' + (paErr?.message ?? '-') +
    ' staffErr=' + (staffErr?.message ?? '-'),
  );

  if (pa) redirect('/superadmin');
  if (staff) redirect((staff as { role: string }).role === 'instructor' ? '/coach' : '/admin');
  redirect('/dashboard');
}
