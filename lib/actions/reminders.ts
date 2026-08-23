'use server';

import { revalidatePath } from 'next/cache';
import { requireStaff, ADMIN_ROLES } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { deliverRenewalReminder, inSlices, type NotifyGym } from '@/lib/notify';
import { watDateISO } from '@/lib/format';

export type RemindResult = { ok: boolean; sent: number; error: string | null };

type Sb = Awaited<ReturnType<typeof createClient>>;
type Contact = { id: string; email: string | null; phone: string | null; full_name: string | null; notification_email: boolean | null };

// The full Gym row carries the notif_* toggles and plan tier, but they
// postdate the generated types — same cast pattern as the settings page.
function asNotifyGym(gym: { id: string; name?: string | null }): NotifyGym {
  const g = gym as NotifyGym & { subscription_plan?: string | null };
  // Spread, don't hand-list. requireStaff already loaded `gyms.*`, and the
  // previous five-field copy silently dropped slug, logo_url, brand_color and
  // email — so every staff-triggered reminder went out with GymFlow branding
  // and a Renew button pointing at the apex host instead of the gym's own
  // subdomain. Only the toggles need defaulting.
  return {
    ...g,
    id: gym.id,
    name: gym.name ?? null,
    subscription_plan: g.subscription_plan ?? null,
    notif_renewal_nudges: g.notif_renewal_nudges ?? true,
    notif_payment_receipts: g.notif_payment_receipts ?? true,
  };
}

function daysUntil(endDate: string): number {
  return Math.max(0, Math.ceil((new Date(endDate).getTime() - Date.now()) / 86_400_000));
}

// Which delivery channels this run attempted — feeds the reminder_logs panel
// so staff can see reminders now leave the app (email always tried when the
// member has one; WhatsApp only on Growth+ per lib/notify.ts).
function channelLabel(outcomes: { email: boolean; whatsapp: boolean }[]): string {
  const parts = ['in_app'];
  if (outcomes.some((o) => o.email)) parts.push('email');
  if (outcomes.some((o) => o.whatsapp)) parts.push('whatsapp');
  return parts.join('+');
}

// Send one renewal reminder for a subscription. Dedup mirrors the cron:
// skip if a reminder for this subscription was created in the last 3 days.
// Staff INSERT on notifications is covered by the existing staff policy.
async function remind(supabase: Sb, gym: NotifyGym, sub: { id: string; member_id: string | null; end_date: string | null }): Promise<{ sent: boolean; outcome: { email: boolean; whatsapp: boolean } }> {
  const none = { email: false, whatsapp: false };
  if (!sub.member_id || !sub.end_date) return { sent: false, outcome: none };
  const cutoff = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const { data: existing } = await supabase
    .from('notifications').select('id')
    .eq('user_id', sub.member_id).eq('type', 'warning')
    .filter('metadata->>subscription_id', 'eq', sub.id)
    .gte('created_at', cutoff).limit(1).maybeSingle();
  if (existing) return { sent: false, outcome: none };

  const days = daysUntil(sub.end_date);
  const { error } = await supabase.from('notifications').insert({
    gym_id: gym.id, user_id: sub.member_id, type: 'warning', channel: 'in_app',
    title: 'Membership expiring soon',
    body: `Your membership ends in ${days} day${days === 1 ? '' : 's'}. Renew to keep training.`,
    metadata: { kind: 'renewal_reminder', subscription_id: sub.id },
  });
  if (error) return { sent: false, outcome: none };

  // In-app row written (the system of record) — now the external channels.
  // Staff can read their members' profiles under the existing RLS policy.
  const { data: contact } = await supabase.from('profiles')
    .select('email, phone, full_name, notification_email').eq('id', sub.member_id).maybeSingle();
  const outcome = contact
    ? await deliverRenewalReminder(gym, { email: contact.email, phone: contact.phone, fullName: contact.full_name, wantsEmail: contact.notification_email }, { days, endDate: sub.end_date })
    : none;
  return { sent: true, outcome };
}

// Best-effort delivery log (feeds the "Recent reminders" panel). Tolerates a
// missing INSERT policy so reminding still works before the migration lands.
async function log(supabase: Sb, gymId: string, sent: number, recipients: number, channel: string) {
  if (sent === 0) return;
  await supabase.from('reminder_logs').insert({
    gym_id: gymId, action: 'Renewal reminder', channel,
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

    const notifyGym = asNotifyGym(gym);
    const { sent, outcome } = await remind(supabase, notifyGym, sub);
    await log(supabase, gym.id, sent ? 1 : 0, 1, channelLabel([outcome]));
    revalidatePath('/admin/reminders');
    return { ok: true, sent: sent ? 1 : 0, error: null };
  } catch (e) {
    return { ok: false, sent: 0, error: (e as Error).message };
  }
}

// Remind everyone whose active membership lapses within the next 7 days.
export async function remindAllDue(): Promise<RemindResult> {
  try {
    const { gym } = await requireStaff(ADMIN_ROLES);
    const supabase = await createClient();
    // WAT day boundaries — end_date is a WAT date-only column, so a UTC
    // "today" drops memberships expiring today once it is past 23:00 WAT.
    const today = watDateISO();
    const weekAhead = watDateISO(new Date(Date.now() + 7 * 86_400_000));
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
    const outcomes: { email: boolean; whatsapp: boolean }[] = [];
    if (due.length) {
      const { data: dupes } = await supabase
        .from('notifications').select('user_id, metadata->>subscription_id')
        .eq('type', 'warning').gte('created_at', cutoff)
        .in('user_id', due.map((s) => s.member_id as string));
      const seen = new Set(
        (dupes ?? []).map((d: { user_id: string | null; subscription_id?: string | null }) => `${d.user_id}:${d.subscription_id}`),
      );
      const fresh = due.filter((s) => !seen.has(`${s.member_id}:${s.id}`));
      const rows = fresh.map((s) => {
        const days = daysUntil(s.end_date as string);
        return {
          gym_id: gym.id, user_id: s.member_id, type: 'warning' as const, channel: 'in_app' as const,
          title: 'Membership expiring soon',
          body: `Your membership ends in ${days} day${days === 1 ? '' : 's'}. Renew to keep training.`,
          metadata: { kind: 'renewal_reminder', subscription_id: s.id },
        };
      });
      if (rows.length) {
        const { error } = await supabase.from('notifications').insert(rows);
        if (!error) {
          sent = rows.length;
          // External fan-out: one contact fetch for the whole batch, then
          // bounded-parallel delivery (awaited — serverless won't keep
          // fire-and-forget work alive after the response).
          const notifyGym = asNotifyGym(gym);
          const { data: contacts } = await supabase.from('profiles')
            .select('id, email, phone, full_name, notification_email')
            .in('id', fresh.map((s) => s.member_id as string));
          const byId = new Map(((contacts ?? []) as Contact[]).map((c) => [c.id, c]));
          await inSlices(fresh, 10, async (s) => {
            const c = byId.get(s.member_id as string);
            if (!c) return;
            const outcome = await deliverRenewalReminder(
              notifyGym,
              { email: c.email, phone: c.phone, fullName: c.full_name, wantsEmail: c.notification_email },
              { days: daysUntil(s.end_date as string), endDate: s.end_date },
            );
            outcomes.push(outcome);
          });
        }
      }
    }
    await log(supabase, gym.id, sent, (subs ?? []).length, channelLabel(outcomes));
    revalidatePath('/admin/reminders');
    return { ok: true, sent, error: null };
  } catch (e) {
    return { ok: false, sent: 0, error: (e as Error).message };
  }
}
