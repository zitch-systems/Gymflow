'use server';

import type { Route } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getUser, ACTIVE_GYM_COOKIE } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

// Switch the active gym for a staff member who belongs to more than one. Stores
// the choice in a cookie that resolveStaff()/getStaffGyms() read on every staff
// request. Validates the user actually has an active link to the target gym so
// the cookie can never grant access to a gym they aren't staff at.
export async function setActiveGym(formData: FormData) {
  const gymId = String(formData.get('gymId') ?? '');
  const raw = String(formData.get('redirectTo') ?? '/launch');
  // Only allow internal redirects (no protocol-relative or absolute URLs).
  const redirectTo = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/launch';

  const user = await getUser();
  if (!user || !gymId) redirect('/login');

  const supabase = await createClient();
  const { data: link } = await supabase
    .from('gym_staff_links')
    .select('id')
    .eq('user_id', user.id).eq('gym_id', gymId).eq('is_active', true)
    .maybeSingle();
  if (link) {
    const jar = await cookies();
    jar.set(ACTIVE_GYM_COOKIE, gymId, {
      httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365,
    });
  }
  // redirectTo is validated above to be an internal path; typedRoutes can't
  // narrow a runtime string, so cast.
  redirect(redirectTo as Route);
}
