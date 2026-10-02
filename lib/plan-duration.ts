import { watDateISO } from '@/lib/format';
// Membership-plan billing periods.
//
// A plan stores EITHER duration_days (daily / weekly) OR duration_months
// (monthly / quarterly / yearly). duration_days wins when present; months are
// treated as *calendar* months. Shared by the plan form, the renew checkout and
// the Paystack webhook so the period is computed identically everywhere.

export type PlanInterval = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom';

export type PlanDuration = { duration_days?: number | null; duration_months?: number | null };

// Days in an average calendar month — used only to express short plans as a
// monthly-equivalent for MRR/ARPU roll-ups, never to compute real end dates.
const DAYS_PER_MONTH = 30.4375;

export const INTERVAL_PRESETS: {
  value: Exclude<PlanInterval, 'custom'>;
  label: string;
  days: number | null;
  months: number | null;
  suffix: string;
}[] = [
  { value: 'daily', label: 'Daily', days: 1, months: null, suffix: '/day' },
  { value: 'weekly', label: 'Weekly', days: 7, months: null, suffix: '/week' },
  { value: 'monthly', label: 'Monthly', days: null, months: 1, suffix: '/mo' },
  { value: 'quarterly', label: 'Quarterly', days: null, months: 3, suffix: '/quarter' },
  { value: 'yearly', label: 'Yearly', days: null, months: 12, suffix: '/yr' },
];

// Classify a stored plan into one of the presets (or 'custom' for odd values).
export function intervalOf(p: PlanDuration): PlanInterval {
  const d = p.duration_days ?? 0;
  if (d > 0) return d === 1 ? 'daily' : d === 7 ? 'weekly' : 'custom';
  const m = p.duration_months ?? 0;
  if (m === 1) return 'monthly';
  if (m === 3) return 'quarterly';
  if (m === 12) return 'yearly';
  return 'custom';
}

// Short price suffix, e.g. "/week", "/mo", "/yr", or "/14 days" for custom.
export function planPeriodLabel(p: PlanDuration): string {
  const preset = INTERVAL_PRESETS.find((x) => x.value === intervalOf(p));
  if (preset) return preset.suffix;
  if ((p.duration_days ?? 0) > 0) return `/${p.duration_days} days`;
  const m = p.duration_months ?? 1;
  return `/${m} mo`;
}

// Human sentence for the billing cadence, e.g. "Billed weekly".
export function planCadenceLabel(p: PlanDuration): string {
  const i = intervalOf(p);
  if (i !== 'custom') return `Billed ${i}`;
  if ((p.duration_days ?? 0) > 0) return `Billed every ${p.duration_days} days`;
  const m = p.duration_months ?? 1;
  return `Billed every ${m} month${m === 1 ? '' : 's'}`;
}

// The first covered date of a renewal. end_date is inclusive, so an existing
// period that still covers today is followed by end_date + 1; a lapsed member
// starts on today's WAT calendar date. Keeping this as date-only UTC arithmetic
// makes the result independent of the server's locale and daylight-saving
// rules.
export function renewalBase(endDate: string | Date | null | undefined, now: Date = new Date()): Date {
  const today = watDateISO(now);
  let endDay: string | null = null;

  if (typeof endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    const parsed = new Date(`${endDate}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === endDate) endDay = endDate;
  } else if (endDate != null) {
    const parsed = endDate instanceof Date ? endDate : new Date(endDate);
    if (!Number.isNaN(parsed.getTime())) endDay = watDateISO(parsed);
  }

  if (endDay == null || endDay < today) return utcDate(today);
  const next = utcDate(endDay);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

// The inclusive end date a renewal would produce. The new paid allocation is
// [renewalBase, anniversary), so the stored end is the day before anniversary.
export function projectRenewalEnd(currentEnd: string | Date | null | undefined, p: PlanDuration, now: Date = new Date()): Date {
  return coverageEnd(renewalBase(currentEnd, now), p);
}

// Inclusive final covered date for a new period beginning on `start`.
// N-day plans cover exactly N calendar dates. Month plans end one day before
// the clamped calendar anniversary (31 Jan + one month anniversaries on 28/29
// Feb). This matches private.coverage_end() in the database.
export function coverageEnd(start: Date, p: PlanDuration): Date {
  const firstDay = utcDate(watDateISO(start));
  const d = p.duration_days ?? 0;
  if (d > 0) {
    firstDay.setUTCDate(firstDay.getUTCDate() + d - 1);
    return firstDay;
  }

  const months = Math.max(1, p.duration_months ?? 1);
  const targetMonth = firstDay.getUTCMonth() + months;
  const targetYear = firstDay.getUTCFullYear() + Math.floor(targetMonth / 12);
  const monthInYear = ((targetMonth % 12) + 12) % 12;
  const lastTargetDay = new Date(Date.UTC(targetYear, monthInYear + 1, 0)).getUTCDate();
  const anniversary = new Date(Date.UTC(
    targetYear,
    monthInYear,
    Math.min(firstDay.getUTCDate(), lastTargetDay),
  ));
  anniversary.setUTCDate(anniversary.getUTCDate() - 1);
  return anniversary;
}

/** @deprecated Prefer coverageEnd; this alias now follows inclusive-end rules. */
export const extendDate = coverageEnd;

function utcDate(isoDay: string): Date {
  return new Date(`${isoDay}T00:00:00Z`);
}

// Monthly-equivalent price, for MRR/ARPU only (a ₦2,000/week plan ≈ ₦8,673/mo).
export function monthlyEquivalent(price: number, p: PlanDuration): number {
  const d = p.duration_days ?? 0;
  if (d > 0) return price * (DAYS_PER_MONTH / d);
  return price / Math.max(1, p.duration_months ?? 1);
}
