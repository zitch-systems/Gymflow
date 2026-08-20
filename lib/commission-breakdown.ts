// Rolling per-gym commission rows up into what the platform console shows.
//
// Deliberately NOT 'server-only': the arithmetic is the part that has been wrong
// before (today's rate × all historical volume; platform_only float counted as
// earnings), so it lives in a pure function the suite can exercise directly
// rather than inside a page that needs a database and a session to run.
//
// The rows come from public.platform_commission_by_gym — one per gym, already
// aggregated over every qualifying payment in the window. That matters: this
// module must never be handed a capped page of payment rows and asked for a
// total, which is exactly how a truncated list turns into a wrong number.

import { fmtNaira } from '@/lib/format';

/** One row of public.platform_commission_by_gym, as PostgREST returns it. */
export type GymCommissionRow = {
  gym_id: string;
  gym_name: string | null;
  commission_mode: string | null;
  commission_pct: number | string | null;
  commission_fixed_amount: number | string | null;
  commission_payments: number | string | null;
  commission_total: number | string | null;
  percentage_payments: number | string | null;
  percentage_total: number | string | null;
  flat_payments: number | string | null;
  flat_total: number | string | null;
  unclassified_payments: number | string | null;
  unclassified_total: number | string | null;
  unrecorded_payments: number | string | null;
  held_payments: number | string | null;
  held_total: number | string | null;
};

/** A gym's row, normalised and ready to render. */
export type GymCommission = {
  gymId: string;
  name: string;
  /** The arrangement as it stands TODAY — not what these payments were charged. */
  rateLabel: string;
  payments: number;
  commission: number;
  fromPercentage: number;
  fromFlat: number;
  unclassified: number;
  unrecordedPayments: number;
  heldPayments: number;
  held: number;
};

export type CommissionBreakdown = {
  /** Commission actually kept, across every gym in the window. */
  total: number;
  fromPercentage: number;
  fromFlat: number;
  /** Split rows that recorded an amount but nothing about how it was arrived at. */
  unclassified: number;
  /** Payments that contributed to `total`. */
  payments: number;
  /** Gyms that earned anything at all (a gym can appear with only held float). */
  earningGyms: number;
  /** Money sitting in GymFlow's account that belongs to gyms. NOT earnings. */
  held: number;
  heldPayments: number;
  /** Paid rows that predate per-payment commission records. Not zero — unknown. */
  unrecordedPayments: number;
  /** The rows to render, best-earning first. */
  rows: GymCommission[];
  /** Gyms omitted from `rows` by the display cap, and what they hold between them. */
  hiddenGyms: number;
  hiddenCommission: number;
};

// PostgREST hands numerics back as strings (they exceed JS number precision in
// the general case, even though naira amounts here never do).
const num = (v: number | string | null | undefined): number => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
};

/**
 * A gym's commission arrangement, in the gyms table's own column names.
 *
 * Every surface that describes the deal takes this, not a bare percentage. The
 * percentage alone is not the arrangement: in fixed mode the row still carries
 * one, as Paystack's fallback (see lib/paystack.ts initTransaction), and
 * quoting it describes a deal the gym is not on.
 */
export type Arrangement = {
  mode?: string | null;
  pct?: number | string | null;
  fixed?: number | string | null;
};

/**
 * How this gym is charged today, as a single readable phrase.
 *
 * Reads the gym's own mode rather than inferring one from the payments: a gym
 * moved from 5% to a flat ₦500 last week still has percentage-basis payments in
 * the window, and describing it by its history would state the wrong deal.
 */
export function arrangementLabel(a: Arrangement): string {
  if (a.mode === 'fixed') return `${fmtNaira(num(a.fixed))} flat`;
  const pct = num(a.pct);
  // Trim a trailing .00 — numeric(5,2) means every rate arrives as "5.00".
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}

/** The same, for a row of the aggregate view. */
export function rateLabel(row: Pick<GymCommissionRow, 'commission_mode' | 'commission_pct' | 'commission_fixed_amount'>): string {
  return arrangementLabel({ mode: row.commission_mode, pct: row.commission_pct, fixed: row.commission_fixed_amount });
}

/**
 * What the platform WOULD have kept on payments whose commission was never
 * recorded — an estimate, and only ever shown as one.
 *
 * A flat deal is per payment, not per naira, so the two modes multiply
 * different things: pricing a fixed-mode gym off its stored percentage was
 * quoting the fallback rate against the gym's whole GMV, which on a ₦10m book
 * overstated a ₦500-per-payment deal by more than double.
 */
export function estimatedCommission(a: Arrangement, volume: { gmv: number; payments: number }): number {
  if (a.mode === 'fixed') return num(a.fixed) * volume.payments;
  return volume.gmv * (num(a.pct) / 100);
}

/**
 * Is this gym on the platform's default arrangement?
 *
 * A flat deal is never the default however its fallback percentage happens to
 * be set — the default is a percentage, and a gym left on 5.00 while actually
 * being charged ₦500 a payment is precisely the one an operator needs to see
 * flagged.
 */
export function isDefaultArrangement(a: Arrangement, defaultPct: number): boolean {
  return a.mode !== 'fixed' && num(a.pct) === defaultPct;
}

/**
 * Roll the per-gym rows up into the console's breakdown.
 *
 * `limit` caps the rendered list only. Every total is summed over ALL rows and
 * the omitted ones are reported (hiddenGyms / hiddenCommission) so a shortened
 * table can never be mistaken for the whole book.
 */
export function summarizeCommission(rows: GymCommissionRow[], limit = 50): CommissionBreakdown {
  const all: GymCommission[] = rows.map((r) => ({
    gymId: r.gym_id,
    name: r.gym_name?.trim() || 'Unnamed gym',
    rateLabel: rateLabel(r),
    payments: num(r.commission_payments),
    commission: num(r.commission_total),
    fromPercentage: num(r.percentage_total),
    fromFlat: num(r.flat_total),
    unclassified: num(r.unclassified_total),
    unrecordedPayments: num(r.unrecorded_payments),
    heldPayments: num(r.held_payments),
    held: num(r.held_total),
  }));

  // The function already orders by commission, but the ordering is what decides
  // which gyms survive the cap, so it is not left to the caller's query to have
  // got right.
  const sorted = [...all].sort((a, b) => b.commission - a.commission || a.name.localeCompare(b.name));
  const shown = limit > 0 ? sorted.slice(0, limit) : sorted;
  const hidden = sorted.slice(shown.length);

  const sum = (pick: (g: GymCommission) => number) => all.reduce((s, g) => s + pick(g), 0);

  return {
    total: sum((g) => g.commission),
    fromPercentage: sum((g) => g.fromPercentage),
    fromFlat: sum((g) => g.fromFlat),
    unclassified: sum((g) => g.unclassified),
    payments: sum((g) => g.payments),
    earningGyms: all.filter((g) => g.commission > 0).length,
    held: sum((g) => g.held),
    heldPayments: sum((g) => g.heldPayments),
    unrecordedPayments: sum((g) => g.unrecordedPayments),
    rows: shown,
    hiddenGyms: hidden.length,
    hiddenCommission: hidden.reduce((s, g) => s + g.commission, 0),
  };
}

/** Windows the revenue page offers. `null` days = everything on record. */
export const COMMISSION_PERIODS = [
  ['30', '30 days', 30],
  ['90', '90 days', 90],
  ['365', '12 months', 365],
  ['all', 'All time', null],
] as const;

export type CommissionPeriodKey = (typeof COMMISSION_PERIODS)[number][0];

/** Resolve a `?p=` value to a window start, defaulting to 30 days. */
export function commissionPeriod(key: string | undefined, now = new Date()): {
  key: CommissionPeriodKey; label: string; from: Date | null;
} {
  const found = COMMISSION_PERIODS.find(([k]) => k === key) ?? COMMISSION_PERIODS[0];
  const [k, label, days] = found;
  return { key: k, label, from: days === null ? null : new Date(now.getTime() - days * 86_400_000) };
}
