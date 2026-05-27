'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getGymBySlug } from '@/lib/auth/gym';
import { getSessionUser } from '@/lib/auth/dal';

export type CheckInResult =
  | {
      ok: true;
      memberName: string;
      daysLeft: number | null;
      subscriptionEndDate: string | null;
    }
  | { ok: false; error: string };

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export async function checkInBySlug(
  slug: string,
  memberId: string,
  opts: { method?: 'qr' | 'manual' | 'self'; deviceInfo?: string } = {},
): Promise<CheckInResult> {
  if (!memberId) return { ok: false, error: 'Member ID required' };

  const gym = await getGymBySlug(slug);
  if (!gym) return { ok: false, error: 'Gym not found' };

  const supabase = await createClient();

  const { data: link } = await supabase
    .from('gym_member_links')
    .select('id, status, is_active')
    .eq('gym_id', gym.id)
    .eq('user_id', memberId)
    .maybeSingle();

  if (!link) return { ok: false, error: 'Not a member of this gym' };
  if (link.is_active === false) return { ok: false, error: 'Membership is inactive' };

  const todayIso = new Date().toISOString();
  const { data: subs } = await supabase
    .from('memberships')
    .select('id, end_date, status')
    .eq('member_id', memberId)
    .eq('gym_id', gym.id)
    .eq('status', 'active')
    .gte('end_date', todayIso.split('T')[0])
    .order('end_date', { ascending: false })
    .limit(1);
  const sub = subs?.[0] ?? null;

  // Member-initiated check-in (self / QR) requires a valid active subscription.
  // Staff manual check-in may log a visit regardless (e.g. day pass, grace).
  const method = opts.method ?? 'manual';
  if (!sub && method !== 'manual') {
    return { ok: false, error: 'Your membership has expired or is inactive. Please renew to check in.' };
  }

  const twoHoursAgo = new Date(Date.now() - TWO_HOURS_MS).toISOString();
  const { data: recent } = await supabase
    .from('check_ins')
    .select('id')
    .eq('member_id', memberId)
    .eq('gym_id', gym.id)
    .gte('checked_in_at', twoHoursAgo)
    .limit(1);
  if (recent && recent.length > 0) {
    return { ok: false, error: 'Already checked in within the last 2 hours' };
  }

  const { error: insertError } = await supabase.from('check_ins').insert({
    member_id: memberId,
    gym_id: gym.id,
    checked_in_at: todayIso,
    check_in_method: method,
    device_info: opts.deviceInfo ?? null,
    status: 'active',
  });

  if (insertError) return { ok: false, error: insertError.message };

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, first_name, last_name, email')
    .eq('id', memberId)
    .maybeSingle();

  const memberName =
    profile?.full_name ??
    [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') ??
    profile?.email ??
    'Member';

  const daysLeft = sub
    ? Math.max(0, Math.ceil((new Date(sub.end_date).getTime() - Date.now()) / 86_400_000))
    : null;

  revalidatePath(`/admin/staff-checkin`);
  return { ok: true, memberName, daysLeft, subscriptionEndDate: sub?.end_date ?? null };
}

export async function selfCheckIn(slug: string): Promise<CheckInResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };
  return checkInBySlug(slug, user.id, { method: 'self' });
}

export async function selfCheckInByQrPayload(slug: string, scannedPayload: string): Promise<CheckInResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  // Accept three QR payload formats:
  //   1. raw UUID:                       <gym_id>
  //   2. URL with ?g= query param:       https://slug.gymflow.ng/checkin?g=<gym_id>
  //   3. URL ending in /checkin:         https://slug.gymflow.ng/checkin
  let scannedGymId: string | null = null;
  const trimmed = scannedPayload.trim();
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRe.test(trimmed)) {
    scannedGymId = trimmed.toLowerCase();
  } else {
    try {
      const u = new URL(trimmed);
      const g = u.searchParams.get('g');
      if (g && uuidRe.test(g)) scannedGymId = g.toLowerCase();
    } catch {
      // not a URL — fall through
    }
  }

  const gym = await getGymBySlug(slug);
  if (!gym) return { ok: false, error: 'Gym not found' };

  if (!scannedGymId) {
    return { ok: false, error: 'Invalid QR code. Make sure you scanned the gym entrance code.' };
  }
  if (scannedGymId !== gym.id.toLowerCase()) {
    return { ok: false, error: 'That QR belongs to a different gym.' };
  }

  return checkInBySlug(slug, user.id, { method: 'qr' });
}
