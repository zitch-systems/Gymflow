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

// Extend `from` by one billing period. Days are exact; months are calendar
// months (so a monthly plan on the 31st lands on the right day). Returns a
// new Date — the caller decides how to serialise it.
export function extendDate(from: Date, p: PlanDuration): Date {
  const out = new Date(from);
  const d = p.duration_days ?? 0;
  if (d > 0) out.setDate(out.getDate() + d);
  else out.setMonth(out.getMonth() + Math.max(1, p.duration_months ?? 1));
  return out;
}

// Monthly-equivalent price, for MRR/ARPU only (a ₦2,000/week plan ≈ ₦8,673/mo).
export function monthlyEquivalent(price: number, p: PlanDuration): number {
  const d = p.duration_days ?? 0;
  if (d > 0) return price * (DAYS_PER_MONTH / d);
  return price / Math.max(1, p.duration_months ?? 1);
}
