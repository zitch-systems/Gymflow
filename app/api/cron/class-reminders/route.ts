import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendClassReminder } from '@/lib/email';
import { waClassReminder } from '@/lib/whatsapp';
import { respectsEmail, respectsWhatsapp } from '@/lib/notification-prefs';
import { reportCronCap } from '@/lib/cron-observability';

// Daily class-reminder cron. Runs once per day; finds every booking dated
// TODAY with status='booked' and fires a "see you soon" notification per
// the member's opt-in flags.
//
// Why TODAY rather than "1 hour before each class"? Same-day reminders cover
// every gym timezone with one job. Per-class-hour timing would require either
// (a) a queue with scheduled tasks or (b) a 15-min cron tick that re-scans.
// At our current volume, "today, in the morning" is the right tradeoff.

export const runtime = 'nodejs';
export const maxDuration = 60;

const CONCURRENCY = 8;
const MAX_ROWS_PER_RUN = 500;

function isoDate(d: Date) {
  return d.toISOString().split('T')[0];
}

function assertAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = request.headers.get('authorization');
  if (header === `Bearer ${expected}`) return true;
  return request.headers.get('x-vercel-cron-signature') === expected;
}

export async function GET(request: Request) {
  if (!assertAuthorized(request)) return new NextResponse('Unauthorized', { status: 401 });

  const supabase = createAdminClient();
  const today = isoDate(new Date());
  const summary = { sent: 0, failed: 0, skipped_optout: 0 };

  // Pull bookings whose class is TODAY and the member is still booked (not
  // cancelled, not already attended). Join the class name, schedule start
  // time, member profile (email/phone + notification prefs), and the gym
  // slug for the deep-link.
  const { data: due } = await supabase
    .from('class_bookings')
    .select(
      'id, member_id, gym_id, booking_date, classes(name), class_schedules(start_time), gyms(slug), profiles:member_id(email, phone, full_name, first_name, notification_email, notification_whatsapp)' as never,
    )
    .eq('booking_date', today)
    .eq('status', 'booked')
    .limit(MAX_ROWS_PER_RUN + 1); // +1 so we know if the cap was hit

  type Row = {
    id: string;
    member_id: string | null;
    gym_id: string | null;
    booking_date: string | null;
    classes: { name: string | null } | Array<{ name: string | null }> | null;
    class_schedules: { start_time: string | null } | Array<{ start_time: string | null }> | null;
    gyms: { slug: string | null } | Array<{ slug: string | null }> | null;
    profiles: {
      email: string | null;
      phone: string | null;
      full_name: string | null;
      first_name: string | null;
      notification_email: boolean | null;
      notification_whatsapp: boolean | null;
    } | Array<{
      email: string | null;
      phone: string | null;
      full_name: string | null;
      first_name: string | null;
      notification_email: boolean | null;
      notification_whatsapp: boolean | null;
    }> | null;
  };
  const rows = ((due ?? []) as unknown as Row[]).slice(0, MAX_ROWS_PER_RUN);
  const skipped = Math.max(0, ((due as unknown as Row[] | null)?.length ?? 0) - rows.length);

  async function processOne(r: Row): Promise<void> {
    const cls = Array.isArray(r.classes) ? r.classes[0] : r.classes;
    const sched = Array.isArray(r.class_schedules) ? r.class_schedules[0] : r.class_schedules;
    const gym = Array.isArray(r.gyms) ? r.gyms[0] : r.gyms;
    const profile = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
    if (!profile?.email && !profile?.phone) return;
    const className = cls?.name ?? 'class';
    const classTime = sched?.start_time ?? null;
    const name = profile?.full_name ?? profile?.first_name ?? 'Member';
    const classesUrl = gym?.slug ? `https://${gym.slug}.gymflow.ng/classes` : '/classes';

    const emailOk = profile?.email && respectsEmail(profile);
    const waOk = profile?.phone && respectsWhatsapp(profile);
    if (!emailOk && !waOk) {
      summary.skipped_optout++;
      return;
    }

    const args = { name, className, classDate: r.booking_date ?? today, classTime, classesUrl };
    const [email, wa] = await Promise.allSettled([
      emailOk ? sendClassReminder(profile!.email!, args) : Promise.resolve({ ok: false, error: 'email_opted_out' }),
      waOk ? waClassReminder(profile!.phone!, args) : Promise.resolve({ ok: false, error: 'no_phone_or_opted_out' }),
    ]);
    const okE = email.status === 'fulfilled' && (email.value as { ok?: boolean })?.ok;
    const okW = wa.status === 'fulfilled' && (wa.value as { ok?: boolean })?.ok;
    if (okE || okW) summary.sent++;
    else summary.failed++;
  }

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const chunk = rows.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map((row) =>
        processOne(row).catch((e) => {
          console.error('[GF class-reminders] row failed:', (e as Error).message);
          summary.failed++;
        }),
      ),
    );
  }

  reportCronCap({ cron: 'class-reminders', processed: rows.length, skipped, extra: summary });
  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), processed: rows.length, skipped, ...summary });
}
