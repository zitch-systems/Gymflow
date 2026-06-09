'use server';

import { revalidatePath } from 'next/cache';
import { requireStaff } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

export type RemindResult = { ok: boolean; sent: number; error: string | null };

type Sb = Awaited<ReturnType<typeof createClient>>;

// Send one in-app renewal reminder for a subscription. Dedup mirrors the cron:
// skip if a reminder for this subscription was created in the last 3 days.
// Staff INSERT on notifications is covered by the existing staff policy.
async function remind(supabase: Sb, gymId: string, sub: { id: string; member_id: string | null; end_date: string | null }): Promise<boolean> {
  if (!sub.member_id || !sub.end_date) return false;
  const cutoff = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const { data: existing } = await supabase
    .from('notifications').select('id')
    .eq('user_id', sub.member_id).eq('type', 'warning')
    .filter('metadata->>subscription_id', 'eq', sub.id)
    .gte('created_at', cutoff).limit(1).maybeSingle();
  if (existing) return false;

  const days = Math.max(0, Math.ceil((new Date(sub.end_date).getTime() - Date.now()) / 86_400_000));
  const { error } = await supabase.from('notifications').insert({
    gym_id: gymId, user_id: sub.member_id, type: 'warning', channel: 'in_app',
    title: 'Membership expiring soon',
    body: `Your membership ends in ${days} day${days === 1 ? '' : 's'}. Renew to keep training.`,
    metadata: { kind: 'renewal_reminder', subscription_id: sub.id },
  });
  return !error;
}

// Best-effort delivery log (feeds the "Recent reminders" panel). Tolerates a
// missing INSERT policy so reminding still works before the migration lands.
async function log(supabase: Sb, gymId: string, sent: number, recipients: number) {
  if (sent === 0) return;
  await supabase.from('reminder_logs').insert({
    gym_id: gymId, action: 'Renewal reminder', channel: 'in_app',
    sent_count: sent, recipient_count: recipients,
    message_preview: 'Your membership ends soon. Renew to keep training.',
  });
}

// Remind a single member from the expiring list.
export async function remindMember(subscriptionId: string): Promise<RemindResult> {
  try {
    const { gym } = await requireStaff();
    const supabase = await createClient();
    const { data: sub } = await supabase
      .from('member_subscriptions').select('id, member_id, end_date')
      .eq('id', subscriptionId).eq('gym_id', gym.id).maybeSingle();
    if (!sub) return { ok: false, sent: 0, error: 'Subscription not found.' };

    const sent = (await remind(supabase, gym.id, sub)) ? 1 : 0;
    await log(supabase, gym.id, sent, 1);
    revalidatePath('/admin/reminders');
    return { ok: true, sent, error: null };
  } catch (e) {
    return { ok: false, sent: 0, error: (e as Error).message };
  }
}

// Remind everyone whose active membership lapses within the next 7 days.
export async function remindAllDue(): Promise<RemindResult> {
  try {
    const { gym } = await requireStaff();
    const supabase = await createClient();
    const today = new Date().toISOString().slice(0, 10);
    const weekAhead = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const { data: subs } = await supabase
      .from('member_subscriptions').select('id, member_id, end_date')
      .eq('gym_id', gym.id).eq('status', 'active').gte('end_date', today).lte('end_date', weekAhead)
      .limit(100);

    let sent = 0;
    for (const sub of subs ?? []) if (await remind(supabase, gym.id, sub)) sent++;
    await log(supabase, gym.id, sent, (subs ?? []).length);
    revalidatePath('/admin/reminders');
    return { ok: true, sent, error: null };
  } catch (e) {
    return { ok: false, sent: 0, error: (e as Error).message };
  }
}
