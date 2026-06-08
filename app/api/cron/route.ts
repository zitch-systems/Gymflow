import { createClient as createSb } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Authorized via CRON_SECRET — Vercel Cron sends it as a Bearer token; an
// external scheduler can pass ?secret= or the same header.
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get('authorization');
  return auth === `Bearer ${secret}` || new URL(req.url).searchParams.get('secret') === secret;
}

export async function GET(req: Request) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 });

  let admin: ReturnType<typeof createAdminClient> | null = null;
  try { admin = createAdminClient(); } catch { admin = null; }

  // Keep-warm: a cheap query so the (free-tier) Supabase project doesn't pause.
  const warm = admin ?? createSb(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  await warm.from('gyms').select('id', { head: true, count: 'exact' });

  // Renewal reminders — needs service role (writes notifications across users).
  let remindersCreated = 0;
  if (admin) {
    const today = new Date().toISOString().slice(0, 10);
    const in3 = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const cutoff = new Date(Date.now() - 3 * 86_400_000).toISOString();

    const { data: subs } = await admin.from('member_subscriptions')
      .select('id, member_id, gym_id, end_date')
      .eq('status', 'active').gte('end_date', today).lte('end_date', in3);

    for (const s of subs ?? []) {
      if (!s.member_id || !s.end_date) continue;
      const { data: existing } = await admin.from('notifications')
        .select('id').eq('user_id', s.member_id).eq('type', 'warning')
        .filter('metadata->>subscription_id', 'eq', s.id)
        .gte('created_at', cutoff).limit(1).maybeSingle();
      if (existing) continue;

      const days = Math.max(0, Math.ceil((new Date(s.end_date).getTime() - Date.now()) / 86_400_000));
      await admin.from('notifications').insert({
        gym_id: s.gym_id, user_id: s.member_id, type: 'warning', channel: 'in_app',
        title: 'Membership expiring soon',
        body: `Your membership ends in ${days} day${days === 1 ? '' : 's'}. Renew to keep training.`,
        metadata: { kind: 'renewal_reminder', subscription_id: s.id },
      });
      remindersCreated++;
    }
  }

  return Response.json({ ok: true, warmed: true, serviceRole: Boolean(admin), remindersCreated });
}
