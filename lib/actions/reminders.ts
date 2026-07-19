'use server';

import { revalidatePath } from 'next/cache';
import { requireStaff, ADMIN_ROLES } from '@/lib/auth/dal';
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
    const { gym } = await requireStaff(ADMIN_ROLES);
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
    const { gym } = await requireStaff(ADMIN_ROLES);
    const supabase = await createClient();
    const today = new Date().toISOString().slice(0, 10);
    const weekAhead = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const { data: subs } = await supabase
      .from('member_subscriptions').select('id, member_id, end_date')
      .eq('gym_id', gym.id).eq('status', 'active').gte('end_date', today).lte('end_date', weekAhead)
      .limit(100);

    // Batch instead of a dedup SELECT + INSERT per subscription (the old loop was
    // an N+1): one windowed dedup query keyed by (user_id, subscription_id) + one
    // bulk insert, mirroring app/api/cron/route.ts. Same 3-day dedup window,
    // notification payload and dedup semantics as remind(); on a bulk-insert error
    // `sent` stays 0 because nothing was written.
    const cutoff = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const due = (subs ?? []).filter((s) => s.member_id && s.end_date);
    let sent = 0;
    if (due.length) {
      const { data: dupes } = await supabase
        .from('notifications').select('user_id, metadata->>subscription_id')
        .eq('type', 'warning').gte('created_at', cutoff)
        .in('user_id', due.map((s) => s.member_id as string));
      const seen = new Set(
        (dupes ?? []).map((d: { user_id: string | null; subscription_id?: string | null }) => `${d.user_id}:${d.subscription_id}`),
      );
      const rows = due
        .filter((s) => !seen.has(`${s.member_id}:${s.id}`))
        .map((s) => {
          const days = Math.max(0, Math.ceil((new Date(s.end_date as string).getTime() - Date.now()) / 86_400_000));
          return {
            gym_id: gym.id, user_id: s.member_id, type: 'warning' as const, channel: 'in_app' as const,
            title: 'Membership expiring soon',
            body: `Your membership ends in ${days} day${days === 1 ? '' : 's'}. Renew to keep training.`,
            metadata: { kind: 'renewal_reminder', subscription_id: s.id },
          };
        });
      if (rows.length) {
        const { error } = await supabase.from('notifications').insert(rows);
        if (!error) sent = rows.length;
      }
    }
    await log(supabase, gym.id, sent, (subs ?? []).length);
    revalidatePath('/admin/reminders');
    return { ok: true, sent, error: null };
  } catch (e) {
    return { ok: false, sent: 0, error: (e as Error).message };
  }
}
