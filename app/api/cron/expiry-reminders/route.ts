import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendExpiryReminder, sendExpired } from '@/lib/email';
import { waExpiryReminder } from '@/lib/whatsapp';

// Vercel hits this once a day via vercel.json schedule; protect with CRON_SECRET.
// Sends reminders at 7, 3, 1 days before expiry, and an "expired" notice on day 0.

export const runtime = 'nodejs';
export const maxDuration = 60;

const REMINDER_DAYS = [7, 3, 1] as const;
const DAY_MS = 86_400_000;

function isoDate(d: Date) {
  return d.toISOString().split('T')[0];
}

function assertAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = request.headers.get('authorization');
  if (header === `Bearer ${expected}`) return true;
  // Vercel cron passes its own header alternative:
  return request.headers.get('x-vercel-cron-signature') === expected;
}

export async function GET(request: Request) {
  if (!assertAuthorized(request)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const supabase = createAdminClient();
  const now = new Date();
  const summary = { sent: 0, failed: 0, expired: 0 };

  for (const days of REMINDER_DAYS) {
    const target = isoDate(new Date(now.getTime() + days * DAY_MS));
    const { data: rows } = await supabase
      .from('memberships')
      .select('id, member_id, gym_id, end_date, auto_renew, auto_debit_enabled, gyms(name, slug), profiles:member_id(email, phone, full_name, first_name)')
      .eq('status', 'active')
      .eq('end_date', target);

    for (const r of rows ?? []) {
      const profile = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
      const gym = Array.isArray(r.gyms) ? r.gyms[0] : r.gyms;
      if (!profile?.email || !gym?.slug) continue;
      const name = profile.full_name ?? profile.first_name ?? 'Member';
      const renewUrl = `https://${gym.slug}.gymflow.ng/dashboard/renew`;
      const autoDebit = !!(r.auto_renew || r.auto_debit_enabled);
      const args = { name, daysLeft: days, endDate: r.end_date, renewUrl, autoDebit };
      const [email, wa] = await Promise.allSettled([
        sendExpiryReminder(profile.email, args),
        profile.phone ? waExpiryReminder(profile.phone, args) : Promise.resolve({ ok: false, error: 'no_phone' }),
      ]);
      const okE = email.status === 'fulfilled' && email.value.ok;
      const okW = wa.status === 'fulfilled' && wa.value.ok;
      if (okE || okW) summary.sent++;
      else summary.failed++;
      await supabase.from('reminder_logs').insert({
        gym_id: r.gym_id ?? null,
        action: `expiry_${days}d`,
        channel: okE && okW ? 'email_whatsapp' : okE ? 'email' : okW ? 'whatsapp' : 'none',
        recipient_count: 1,
        sent_count: okE && okW ? 2 : okE || okW ? 1 : 0,
        failed_count: okE && okW ? 0 : okE || okW ? 1 : 2,
        message_preview: `Expiry in ${days}d for ${profile.email}`,
      });
    }
  }

  // Mark expired only once the 3-day auto-debit retry/grace window has passed
  // (end_date <= today-3). Using a range, not an exact date, so a skipped cron
  // run still catches every overdue membership.
  const expiredCutoff = isoDate(new Date(now.getTime() - 3 * DAY_MS));
  const { data: expiredRows } = await supabase
    .from('memberships')
    .select('id, member_id, gym_id, end_date, status, gyms(slug), profiles:member_id(email, full_name, first_name)')
    .eq('status', 'active')
    .lte('end_date', expiredCutoff);
  for (const r of expiredRows ?? []) {
    const profile = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
    const gym = Array.isArray(r.gyms) ? r.gyms[0] : r.gyms;
    if (!profile?.email || !gym?.slug) continue;
    const name = profile.full_name ?? profile.first_name ?? 'Member';
    await sendExpired(profile.email, name, `https://${gym.slug}.gymflow.ng/dashboard/renew`);
    await supabase.from('memberships').update({ status: 'expired' }).eq('id', r.id);
    summary.expired++;
  }

  return NextResponse.json({ ok: true, ranAt: now.toISOString(), ...summary });
}
