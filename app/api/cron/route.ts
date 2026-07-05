import { createHash, timingSafeEqual } from 'crypto';
import { createClient as createSb } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Constant-time compare that doesn't leak length (hash both to a fixed width
// first) — guards the secret comparison against timing side-channels.
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

// Authorized via CRON_SECRET — Vercel Cron sends it as a Bearer token. The
// query-string form (?secret=) remains as a fallback for external schedulers
// that can't set headers; prefer the header in production since query strings
// land in access/proxy logs.
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get('authorization');
  if (auth && safeEqual(auth, `Bearer ${secret}`)) return true;
  const qs = new URL(req.url).searchParams.get('secret');
  return qs != null && safeEqual(qs, secret);
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

    const due = (subs ?? []).filter((s) => s.member_id && s.end_date);
    if (due.length) {
      // Batch the dedup into ONE query (was a SELECT per subscription → N+1 that
      // could exceed the 60s budget on large platforms), then bulk-insert.
      const { data: dupes } = await admin.from('notifications')
        .select('user_id, metadata->>subscription_id')
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
            gym_id: s.gym_id, user_id: s.member_id, type: 'warning' as const, channel: 'in_app' as const,
            title: 'Membership expiring soon',
            body: `Your membership ends in ${days} day${days === 1 ? '' : 's'}. Renew to keep training.`,
            metadata: { kind: 'renewal_reminder', subscription_id: s.id },
          };
        });
      if (rows.length) {
        const { error } = await admin.from('notifications').insert(rows);
        if (!error) remindersCreated = rows.length;
      }
    }
  }

  // Housekeeping: rate-limit windows are minutes-to-hours; anything older
  // than 2 days is dead weight. Best-effort.
  if (admin) {
    const stale = new Date(Date.now() - 2 * 86_400_000).toISOString();
    await admin.from('rate_limits').delete().lt('window_start', stale);
  }

  return Response.json({ ok: true, warmed: true, serviceRole: Boolean(admin), remindersCreated });
}
