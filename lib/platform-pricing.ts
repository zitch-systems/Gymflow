// Platform subscription pricing — what a gym pays GymFlow (B2B billing).
// Shared by the signup form (client), the initiate route, and onboarding (server).

export const PLATFORM_PRICING = {
  monthly: { amount: 22_999, label: 'Monthly', months: 1 },
  annual: { amount: 229_999, label: 'Annual', months: 12 },
} as const;

export type BillingPeriod = keyof typeof PLATFORM_PRICING;

export function isBillingPeriod(v: unknown): v is BillingPeriod {
  return v === 'monthly' || v === 'annual';
}

// Naira, formatted with thousands separators (e.g. "₦22,999").
export function formatNaira(amount: number): string {
  return '₦' + amount.toLocaleString('en-NG');
}
