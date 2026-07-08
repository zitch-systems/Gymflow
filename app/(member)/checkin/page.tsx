import { requireMember } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { watDateISO, watDayStartUtc } from '@/lib/format';
import { CheckinClient } from './checkin-client';

export const metadata = { title: 'Check in' };
export const dynamic = 'force-dynamic';

// Check-in / check-out. The server resolves whether the member has an open
// visit today (checked in, not yet out) so the client renders the right
// direction immediately — including for the door QR's ?via=qr auto-run.
export default async function CheckinPage() {
  const { user, gym } = await requireMember();
  const supabase = await createClient();

  const { data: open } = await supabase
    .from('check_ins').select('id, checked_in_at')
    .eq('member_id', user.id).eq('gym_id', gym.id)
    .eq('status', 'active').is('checked_out_at', null)
    .gte('checked_in_at', watDayStartUtc(watDateISO()))
    .order('checked_in_at', { ascending: false })
    .limit(1).maybeSingle();

  return <CheckinClient initialCheckedIn={Boolean(open)} checkedInAt={open?.checked_in_at ?? null} />;
}
