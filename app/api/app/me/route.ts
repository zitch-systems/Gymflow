import { requireApiMember, json, corsPreflight, publicGym } from '@/lib/api-app';
import { daysLeft, watNow, watDateISO, watDayStartUtc } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export function OPTIONS() {
  return corsPreflight();
}

// GET /api/app/me — everything the app's home screen draws, in one round-trip.
//
// The web dashboard is a Server Component that queries Supabase and renders the
// result; the phone can't do that, so this endpoint is the same set of queries
// with the same WAT day-bucketing, returning the computed numbers rather than
// rows for the app to re-derive. Streaks and week grids computed twice, in two
// languages, would drift the first time either side was touched.
export async function GET(req: Request) {
  const auth = await requireApiMember(req);
  if (!auth.ok) return auth.res;
  const { supabase, user, gym, link } = auth.ctx;

  try {
    const now = new Date();
    // All day math is anchored to WAT (UTC+1) — the server runs UTC, so a UTC
    // day boundary mis-buckets check-ins between 00:00–01:00 WAT onto the
    // previous day (wrong streak, week grid and "today"). See lib/format.ts.
    const wnow = watNow();
    const today = watDateISO();
    const dow = (wnow.getUTCDay() + 6) % 7; // 0 = Monday (WAT)
    const weekStartDate = watDateISO(new Date(now.getTime() - dow * 86_400_000));
    const weekStartIso = watDayStartUtc(weekStartDate);
    const monthStartIso = watDayStartUtc(`${today.slice(0, 7)}-01`);
    const since = new Date(now.getTime() - 70 * 86_400_000).toISOString();

    const [{ data: sub }, { count: unread }, { data: allCheckins }, { count: classesAttended }, { data: nextBooking }, { data: profile }] = await Promise.all([
      // past_due is included so the app can raise the dunning banner when
      // Paystack failed the last auto-charge; it still counts as access until
      // the grace window closes.
      supabase.from('member_subscriptions').select('status, start_date, end_date, plan_id, pause_start, pause_end')
        .eq('member_id', user.id).eq('gym_id', gym.id).in('status', ['active', 'past_due', 'paused', 'pause_requested'])
        .order('end_date', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('is_read', false),
      supabase.from('check_ins').select('checked_in_at, checked_out_at, check_in_method')
        .eq('member_id', user.id).eq('gym_id', gym.id).gte('checked_in_at', since).order('checked_in_at', { ascending: false }),
      supabase.from('class_bookings').select('id', { count: 'exact', head: true }).eq('member_id', user.id).eq('gym_id', gym.id).eq('status', 'attended'),
      supabase.from('class_bookings').select('booking_date, class_id, status')
        .eq('member_id', user.id).eq('gym_id', gym.id).gte('booking_date', today).in('status', ['booked', 'confirmed'])
        .order('booking_date', { ascending: true }).limit(1).maybeSingle(),
      supabase.from('profiles').select('id, email, full_name, first_name, last_name, phone').eq('id', user.id).maybeSingle(),
    ]);

    const [{ data: plan }, { data: nextClass }] = await Promise.all([
      sub?.plan_id ? supabase.from('membership_plans').select('name').eq('id', sub.plan_id).maybeSingle() : Promise.resolve({ data: null }),
      nextBooking?.class_id ? supabase.from('classes').select('name, start_time').eq('id', nextBooking.class_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);

    const checkins = allCheckins ?? [];
    // Bucket check-ins by WAT calendar day (not the UTC date of the timestamp)
    // so a 00:00–01:00 WAT visit lands on the right day.
    const daySet = new Set(checkins.map((c) => (c.checked_in_at ? watDateISO(new Date(c.checked_in_at)) : '')).filter(Boolean));
    const visitsThisMonth = checkins.filter((c) => (c.checked_in_at ?? '') >= monthStartIso).length;
    const visitsThisWeek = checkins.filter((c) => (c.checked_in_at ?? '') >= weekStartIso).length;

    // Current streak: consecutive prior WAT days with a check-in (today
    // optional). Anchored at noon UTC of the WAT date so whole-day steps never
    // cross a boundary.
    let streak = 0;
    const cur = new Date(today + 'T12:00:00Z');
    if (!daySet.has(cur.toISOString().slice(0, 10))) cur.setUTCDate(cur.getUTCDate() - 1);
    while (daySet.has(cur.toISOString().slice(0, 10))) { streak++; cur.setUTCDate(cur.getUTCDate() - 1); }

    // Best streak across the window.
    const sortedDays = [...daySet].sort();
    let best = 0, run = 0; let prev: number | null = null;
    for (const k of sortedDays) {
      const t = Date.parse(k);
      run = prev !== null && t - prev === 86_400_000 ? run + 1 : 1;
      best = Math.max(best, run); prev = t;
    }

    // Average session length from completed (checked-out) visits.
    const withDur = checkins.filter((c) => c.checked_out_at && c.checked_in_at);
    const avgMin = withDur.length
      ? Math.round(withDur.reduce((s, c) => s + (new Date(c.checked_out_at!).getTime() - new Date(c.checked_in_at!).getTime()) / 60000, 0) / withDur.length)
      : 0;

    const weekStartMs = Date.parse(weekStartDate + 'T12:00:00Z');
    const week = Array.from({ length: 7 }, (_, i) => {
      const key = new Date(weekStartMs + i * 86_400_000).toISOString().slice(0, 10);
      return { date: key, done: daySet.has(key), today: key === today, future: key > today };
    });

    const remaining = sub?.end_date ? daysLeft(sub.end_date) : 0;
    // The bar under the plan name is the fraction of the paid term still left,
    // so it agrees with the number printed beside it.
    const termDays = sub?.start_date && sub?.end_date
      ? Math.max(1, Math.round((Date.parse(sub.end_date) - Date.parse(sub.start_date)) / 86_400_000))
      : 0;
    const progressPct = termDays > 0 ? Math.min(100, Math.max(0, Math.round((remaining / termDays) * 100))) : 0;

    return json({
      gym: publicGym(gym),
      member: {
        id: user.id,
        email: profile?.email ?? user.email ?? null,
        full_name: profile?.full_name ?? ([profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || null),
        phone: profile?.phone ?? null,
        joined_at: link.joined_at ?? null,
      },
      subscription: sub
        ? {
            status: sub.status,
            plan_name: plan?.name ?? 'Membership',
            start_date: sub.start_date,
            end_date: sub.end_date,
            days_left: remaining,
            progress_pct: progressPct,
            pause_start: sub.pause_start ?? null,
            pause_end: sub.pause_end ?? null,
          }
        : null,
      stats: {
        streak,
        best_streak: best,
        visits_this_week: visitsThisWeek,
        visits_this_month: visitsThisMonth,
        classes_attended: classesAttended ?? 0,
        avg_session_minutes: avgMin,
        weekly_goal: 4,
      },
      week,
      next_class: nextBooking
        ? {
            name: nextClass?.name ?? 'Class',
            date: nextBooking.booking_date,
            start_time: nextClass?.start_time ? String(nextClass.start_time).slice(0, 5) : null,
            status: nextBooking.status,
          }
        : null,
      recent_checkins: checkins.slice(0, 5).map((c) => ({
        checked_in_at: c.checked_in_at,
        checked_out_at: c.checked_out_at,
        method: c.check_in_method,
      })),
      unread_notifications: unread ?? 0,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}
