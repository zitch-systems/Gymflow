import { requireMember } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { watDateISO, watDayStartUtc } from '@/lib/format';
import { CheckinClient, type VisitRow } from './checkin-client';

export const metadata = { title: 'Check in' };
export const dynamic = 'force-dynamic';

// Check-in / check-out. The server resolves whether the member has an open
// visit today (checked in, not yet out) so the client renders the right
// direction immediately — including for the door QR's ?via=qr auto-run — and
// loads recent visit history to show under the actions.
export default async function CheckinPage() {
  const { user, gym } = await requireMember();
  const supabase = await createClient();

  const { data: recent } = await supabase
    .from('check_ins').select('id, checked_in_at, checked_out_at, status, check_in_method')
    .eq('member_id', user.id).eq('gym_id', gym.id)
    .order('checked_in_at', { ascending: false })
    .limit(15);

  const history = (recent ?? []) as VisitRow[];
  const dayStartIso = watDayStartUtc(watDateISO());
  const open = history.find((c) => c.status === 'active' && !c.checked_out_at && (c.checked_in_at ?? '') >= dayStartIso) ?? null;

  return (
    <CheckinClient
      initialCheckedIn={Boolean(open)}
      checkedInAt={open?.checked_in_at ?? null}
      history={history}
    />
  );
}
