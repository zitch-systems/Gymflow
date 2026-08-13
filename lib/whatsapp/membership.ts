import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { daysLeft, fmtNaira, watDateISO, watDayStartUtc } from '@/lib/format';
import { planPeriodLabel } from '@/lib/plan-duration';
import { openStateFor, todayHoursLabel, type HoursRow } from '@/lib/opening-hours';
import type { WhatsAppGym } from '@/lib/whatsapp/settings';
import type { Database } from '@/lib/database.types';

type Admin = SupabaseClient<Database>;

// Every fact the WhatsApp channel can state about a membership, in one place.
//
// Both consumers read from here: the scripted menu, which formats these into
// fixed replies, and the AI assistant, whose tools return these objects
// verbatim. That is the point — the assistant answers from the same query the
// menu uses, so it cannot invent a different number of days remaining than the
// button next to it reports.

export type MembershipSnapshot = {
  active: boolean;
  status: string | null;
  planName: string | null;
  endDate: string | null;
  daysRemaining: number | null;
  /** True while past_due but still inside the paid period — access continues. */
  inGracePeriod: boolean;
};

export async function membershipSnapshot(
  admin: Admin,
  memberId: string,
  gymId: string,
): Promise<MembershipSnapshot> {
  const today = watDateISO();
  const { data } = await admin
    .from('member_subscriptions')
    .select('status, end_date, membership_plans(name)')
    .eq('member_id', memberId)
    .eq('gym_id', gymId)
    .in('status', ['active', 'past_due', 'paused'])
    .order('end_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  const sub = data as { status: string | null; end_date: string | null; membership_plans: { name: string } | { name: string }[] | null } | null;
  if (!sub) {
    return { active: false, status: null, planName: null, endDate: null, daysRemaining: null, inGracePeriod: false };
  }

  // The embed comes back as an object or a single-element array depending on
  // how PostgREST infers the relationship; normalise rather than assume.
  const planRel = sub.membership_plans;
  const planName = Array.isArray(planRel) ? planRel[0]?.name ?? null : planRel?.name ?? null;
  const expired = (sub.end_date ?? '') < today;

  return {
    active: !expired && sub.status !== 'paused',
    status: sub.status,
    planName,
    endDate: sub.end_date,
    daysRemaining: sub.end_date ? daysLeft(sub.end_date) : null,
    inGracePeriod: sub.status === 'past_due' && !expired,
  };
}

export type VisitState = {
  insideNow: boolean;
  checkedInAt: string | null;
  visitsThisMonth: number;
};

export async function visitState(admin: Admin, memberId: string, gymId: string): Promise<VisitState> {
  const today = watDateISO();
  const monthStart = `${today.slice(0, 7)}-01`;

  const [{ data: open }, { count }] = await Promise.all([
    admin
      .from('check_ins')
      .select('checked_in_at')
      .eq('member_id', memberId).eq('gym_id', gymId)
      .eq('status', 'active').is('checked_out_at', null)
      .gte('checked_in_at', watDayStartUtc(today))
      .order('checked_in_at', { ascending: false })
      .limit(1).maybeSingle(),
    admin
      .from('check_ins')
      .select('id', { count: 'exact', head: true })
      .eq('member_id', memberId).eq('gym_id', gymId)
      .gte('checked_in_at', watDayStartUtc(monthStart)),
  ]);

  const row = open as { checked_in_at: string | null } | null;
  return {
    insideNow: Boolean(row),
    checkedInAt: row?.checked_in_at ?? null,
    visitsThisMonth: count ?? 0,
  };
}

export type PlanOption = {
  id: string;
  name: string;
  price: number;
  priceLabel: string;
  periodLabel: string;
  durationDays: number | null;
  durationMonths: number | null;
  description: string | null;
  trainerAddonEnabled: boolean;
  trainerAddonPrice: number | null;
};

/** The gym's sellable packages, cheapest first. */
export async function planOptions(admin: Admin, gymId: string): Promise<PlanOption[]> {
  const { data } = await admin
    .from('membership_plans')
    .select('id, name, description, price, duration_days, duration_months, trainer_addon_enabled, trainer_addon_price')
    .eq('gym_id', gymId)
    .eq('is_active', true)
    .order('price', { ascending: true })
    .limit(20);

  return ((data as Array<{
    id: string; name: string; description: string | null; price: number;
    duration_days: number | null; duration_months: number | null;
    trainer_addon_enabled: boolean | null; trainer_addon_price: number | null;
  }> | null) ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    price: Number(p.price),
    priceLabel: fmtNaira(Number(p.price)),
    periodLabel: planPeriodLabel(p),
    durationDays: p.duration_days,
    durationMonths: p.duration_months,
    description: p.description,
    trainerAddonEnabled: Boolean(p.trainer_addon_enabled),
    trainerAddonPrice: p.trainer_addon_price === null ? null : Number(p.trainer_addon_price),
  }));
}

export type GymFacts = {
  name: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  openNow: boolean | null;
  todayHours: string | null;
};

export async function gymFacts(admin: Admin, gym: WhatsAppGym): Promise<GymFacts> {
  const [{ data: gymRow }, { data: hours }] = await Promise.all([
    admin.from('gyms').select('address, city, email').eq('id', gym.id).maybeSingle(),
    admin.from('business_hours').select('day_of_week, open_time, close_time, is_closed').eq('gym_id', gym.id),
  ]);

  const rows = (hours as HoursRow[] | null) ?? [];
  const state = rows.length ? openStateFor(rows, new Date()) : null;
  const extra = gymRow as { address: string | null; city: string | null; email: string | null } | null;

  return {
    name: gym.name,
    address: extra?.address ?? null,
    city: extra?.city ?? null,
    phone: gym.phone,
    email: extra?.email ?? null,
    openNow: state ? state.open : null,
    todayHours: rows.length ? todayHoursLabel(rows, new Date()) : null,
  };
}

export type UpcomingClass = {
  name: string;
  day: string;
  startTime: string | null;
  instructor: string | null;
};

/** The next few scheduled classes — enough for "what's on this week?". */
export async function upcomingClasses(admin: Admin, gymId: string): Promise<UpcomingClass[]> {
  const { data } = await admin
    .from('class_schedules')
    .select('day_of_week, start_time, classes(name, instructor_id)')
    .eq('gym_id', gymId)
    .order('day_of_week', { ascending: true })
    .limit(10);

  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return ((data as Array<{
    day_of_week: number | null; start_time: string | null;
    classes: { name: string; instructor_id: string | null } | { name: string; instructor_id: string | null }[] | null;
  }> | null) ?? []).map((r) => {
    const rel = r.classes;
    const cls = Array.isArray(rel) ? rel[0] : rel;
    return {
      name: cls?.name ?? 'Class',
      day: DAYS[r.day_of_week ?? 0] ?? 'Unknown',
      startTime: r.start_time,
      instructor: null,
    };
  });
}
