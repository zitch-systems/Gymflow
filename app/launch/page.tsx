import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

// Post-login role router. signIn redirects here after a successful sign-in.
// Uses ONE Supabase client for both auth and the role lookups so the queries
// run in the same authenticated context as getUser (a second client instance
// was coming back empty). Temporary GFDBG2 line confirms the lookup result.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function Launch() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    console.log('GFDBG2 nouser');
    redirect('/login');
  }

  const [{ data: pa, error: paErr }, { data: staff, error: staffErr }] = await Promise.all([
    supabase.from('platform_admins').select('id').eq('user_id', user.id).eq('is_active', true).maybeSingle(),
    supabase.from('gym_staff_links').select('role').eq('user_id', user.id).eq('is_active', true).maybeSingle(),
  ]);
  console.log(
    'GFDBG2 staff=' + ((staff as { role?: string } | null)?.role ?? 'NULL') +
    ' serr=' + (staffErr?.code ?? staffErr?.message ?? 'none') +
    ' pa=' + Boolean(pa) + ' perr=' + (paErr?.code ?? 'none'),
  );

  if (pa) redirect('/superadmin');
  if (staff) redirect((staff as { role: string }).role === 'instructor' ? '/coach' : '/admin');
  redirect('/dashboard');
}
