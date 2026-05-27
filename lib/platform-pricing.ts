// Platform subscription pricing — what a gym pays GymFlow (B2B billing).
// Shared by the signup form (client), the initiate route, and onboarding (server).

export const PLATFORM_PRICING = {
  monthly: { amount: 13_999, label: 'Monthly', months: 1, per: 'mo' },
  quarterly: { amount: 33_999, label: 'Quarterly', months: 3, per: 'qtr' },
  annual: { amount: 119_999, label: 'Annual', months: 12, per: 'yr' },
} as const;

export type BillingPeriod = keyof typeof PLATFORM_PRICING;

// Ordered for display (cheapest commitment first).
export const BILLING_PERIODS: BillingPeriod[] = ['monthly', 'quarterly', 'annual'];

export function isBillingPeriod(v: unknown): v is BillingPeriod {
  return v === 'monthly' || v === 'quarterly' || v === 'annual';
}

// Naira, formatted with thousands separators (e.g. "₦13,999").
export function formatNaira(amount: number): string {
  return '₦' + amount.toLocaleString('en-NG');
}

// Savings vs paying monthly for the same number of months (0 for the monthly plan).
export function periodSavings(period: BillingPeriod): number {
  const p = PLATFORM_PRICING[period];
  return PLATFORM_PRICING.monthly.amount * p.months - p.amount;
}
