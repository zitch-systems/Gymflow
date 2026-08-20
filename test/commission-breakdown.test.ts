import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { asSuperuser, withSession } from './db';
import { IDS, seed } from './seed';
import {
  arrangementLabel, commissionPeriod, estimatedCommission, isDefaultArrangement,
  rateLabel, summarizeCommission, type GymCommissionRow,
} from '../lib/commission-breakdown';

// The platform operator's commission breakdown: what GymFlow actually kept out
// of member payments, per gym, over a window.
//
// Two layers, both pinned here because the two ways this has gone wrong before
// live one in each. The SQL (public.platform_commission_by_gym) decides WHAT
// COUNTS — and the money that must not count is the interesting part: float the
// platform is merely holding for a gym, and commission on a charge that was
// refunded. The pure roll-up (lib/commission-breakdown.ts) decides how the rows
// add up and how much of the list is shown, which is where a capped table can
// quietly become a wrong total.

// ── The aggregate, against the real database ────────────────────────────────

const ADMIN = 'ad000000-0000-0000-0000-0000000000c1';
const OLD_PAYMENT_DAYS = 400;

type Row = Record<string, string | number | null>;

const callAs = (uid: string, from: string | null) =>
  withSession({ role: 'authenticated', uid }, async (c) => {
    const { rows } = await c.query<Row>(
      `select * from public.platform_commission_by_gym($1::timestamptz, null)`, [from],
    );
    return rows;
  });

const n = (v: string | number | null | undefined) => Number(v ?? 0);

const read = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8');

beforeAll(async () => {
  await seed();
  await asSuperuser(async (c) => {
    await c.query(`delete from public.platform_admins where user_id = $1`, [ADMIN]);
    await c.query(`delete from auth.users where id = $1`, [ADMIN]);
    await c.query(`insert into auth.users (id, email) values ($1, $2)`, [ADMIN, 'ops@gymflow.ng']);
    await c.query(`insert into public.platform_admins (user_id, name, email) values ($1, 'Ops', 'ops@gymflow.ng')`, [ADMIN]);

    // Gym B is on the flat arrangement, Gym A on a percentage — so the "rate
    // today" column has both modes to render.
    await c.query(
      `update public.gyms set platform_commission_mode = 'fixed', platform_commission_fixed_amount = 500 where id = $1`,
      [IDS.gymB],
    );
    await c.query(`update public.gyms set platform_commission_pct = 20 where id = $1`, [IDS.gymA]);

    // seed() already left one payment per gym with a NULL settlement — the
    // "predates commission records" case — so nothing extra is inserted for it.
    const pay = async (cols: Record<string, unknown>) => {
      const keys = Object.keys(cols);
      await c.query(
        `insert into public.payments (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')})`,
        keys.map((k) => cols[k]),
      );
    };

    // Gym A: a percentage split and a flat split — ₦1,000 kept between them.
    await pay({ gym_id: IDS.gymA, amount: 10000, status: 'success', payment_status: 'successful', paystack_reference: 'cb-pct', platform_settlement: 'split', platform_commission_basis: 'percentage', platform_commission_pct: 5, platform_commission_amount: 500 });
    await pay({ gym_id: IDS.gymA, amount: 5000, status: 'success', payment_status: 'successful', paystack_reference: 'cb-flat', platform_settlement: 'split', platform_commission_basis: 'flat', platform_commission_amount: 500 });
    // Refunded: the member got their money back, so the cut was not kept.
    await pay({ gym_id: IDS.gymA, amount: 40000, status: 'refunded', payment_status: 'refunded', paystack_reference: 'cb-refunded', platform_settlement: 'split', platform_commission_basis: 'percentage', platform_commission_pct: 5, platform_commission_amount: 2000 });
    // A row that disagrees with ITSELF: refunded on one status column, still
    // successful on the other. trg_sync_payment_status keeps the pair in step,
    // so this should not arise — but the two columns are free text, and a
    // half-applied refund must not be able to enter a revenue total on the
    // strength of its nicer half. Written with the trigger disabled, because the
    // trigger is precisely what would prevent the shape.
    await c.query(`alter table public.payments disable trigger trg_sync_payment_status`);
    await pay({ gym_id: IDS.gymA, amount: 60000, status: 'success', payment_status: 'refunded', paystack_reference: 'cb-half-refunded', platform_settlement: 'split', platform_commission_basis: 'percentage', platform_commission_pct: 5, platform_commission_amount: 3000 });
    await c.query(`alter table public.payments enable trigger trg_sync_payment_status`);
    // platform_only: whole charge landed in GymFlow's account, gym owed its share.
    await pay({ gym_id: IDS.gymA, amount: 8000, status: 'success', payment_status: 'successful', paystack_reference: 'cb-held', platform_settlement: 'platform_only' });
    // Cash at the front desk — the platform never saw it.
    await pay({ gym_id: IDS.gymA, amount: 3000, status: 'success', payment_status: 'successful', paystack_reference: 'MANUAL-cb', platform_settlement: 'offline' });
    // Older than any window the console offers by default.
    await pay({ gym_id: IDS.gymA, amount: 90000, status: 'success', payment_status: 'successful', paystack_reference: 'cb-old', payment_date: new Date(Date.now() - OLD_PAYMENT_DAYS * 86_400_000).toISOString(), platform_settlement: 'split', platform_commission_basis: 'percentage', platform_commission_pct: 10, platform_commission_amount: 9000 });

    // Gym B earns less, so the ordering has something to get right.
    await pay({ gym_id: IDS.gymB, amount: 5000, status: 'success', payment_status: 'successful', paystack_reference: 'cb-b', platform_settlement: 'split', platform_commission_basis: 'flat', platform_commission_amount: 250 });
  });
});

describe('platform_commission_by_gym', () => {
  it('is refused to anyone who is not a platform admin', async () => {
    // A gym owner asking PostgREST directly. SECURITY DEFINER means the function
    // itself is the only thing standing between them and every tenant's book.
    const err = await withSession({ role: 'authenticated', uid: IDS.ownerA }, async (c) => {
      try { await c.query(`select * from public.platform_commission_by_gym(null, null)`); return null; }
      catch (e) { return e as { code?: string }; }
    });
    expect(err?.code).toBe('42501');
  });

  it('sums only the commission actually kept, best-earning gym first', async () => {
    const rows = await callAs(ADMIN, null);
    expect(rows.map((r) => r.gym_id)).toEqual([IDS.gymA, IDS.gymB]);

    const a = rows[0];
    // 500 + 500 in-window, plus the 400-day-old 9,000. Not the refunded 2,000,
    // not the held 8,000, not the offline row.
    expect(n(a.commission_total)).toBe(10000);
    expect(n(a.commission_payments)).toBe(3);
  });

  it('excludes refunded charges from earnings', async () => {
    const rows = await callAs(ADMIN, null);
    const a = rows.find((r) => r.gym_id === IDS.gymA)!;
    // Two refunded rows carry commission figures — ₦2,000 on the cleanly
    // refunded one and ₦3,000 on the half-applied one. Counting either would
    // report commission on money that went back out.
    expect(n(a.commission_total)).toBe(10000);
    expect(n(a.commission_total)).not.toBe(15000);
  });

  it('reports platform_only money as held, never as commission', async () => {
    const rows = await callAs(ADMIN, null);
    const a = rows.find((r) => r.gym_id === IDS.gymA)!;
    expect(n(a.held_total)).toBe(8000);
    expect(n(a.held_payments)).toBe(1);
    // And it is nowhere in the earnings figures.
    expect(n(a.commission_total)).toBe(10000);
    expect(n(a.percentage_total) + n(a.flat_total) + n(a.unclassified_total)).toBe(n(a.commission_total));
  });

  it('splits earnings into percentage and flat, and carries the gym’s current mode', async () => {
    const rows = await callAs(ADMIN, null);
    const a = rows.find((r) => r.gym_id === IDS.gymA)!;
    expect(n(a.percentage_total)).toBe(9500); // 500 in-window + 9,000 historic
    expect(n(a.flat_total)).toBe(500);
    expect(a.commission_mode).toBe('percentage');
    expect(n(a.commission_pct)).toBe(20);

    const b = rows.find((r) => r.gym_id === IDS.gymB)!;
    expect(n(b.flat_total)).toBe(250);
    expect(n(b.percentage_total)).toBe(0);
    expect(b.commission_mode).toBe('fixed');
    expect(n(b.commission_fixed_amount)).toBe(500);
  });

  it('counts payments that predate commission records without guessing at them', async () => {
    const rows = await callAs(ADMIN, null);
    const a = rows.find((r) => r.gym_id === IDS.gymA)!;
    expect(n(a.unrecorded_payments)).toBe(1); // seed()'s payment
    // It contributes nothing to the money figures — NULL is "not recorded", not zero.
    expect(n(a.commission_total)).toBe(10000);
  });

  it('honours the date window', async () => {
    const from = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const rows = await callAs(ADMIN, from);
    const a = rows.find((r) => r.gym_id === IDS.gymA)!;
    // The 400-day-old ₦9,000 drops out; the two recent splits remain.
    expect(n(a.commission_total)).toBe(1000);
    expect(n(a.commission_payments)).toBe(2);
  });
});

// ── The roll-up, pure ───────────────────────────────────────────────────────

const row = (over: Partial<GymCommissionRow> & { gym_id: string }): GymCommissionRow => ({
  gym_name: 'Gym', commission_mode: 'percentage', commission_pct: 5, commission_fixed_amount: 0,
  commission_payments: 0, commission_total: 0, percentage_payments: 0, percentage_total: 0,
  flat_payments: 0, flat_total: 0, unclassified_payments: 0, unclassified_total: 0,
  unrecorded_payments: 0, held_payments: 0, held_total: 0, ...over,
});

describe('summarizeCommission', () => {
  it('adds up earnings and keeps held float out of them', () => {
    // PostgREST hands numerics back as strings; the roll-up must not concatenate.
    const s = summarizeCommission([
      row({ gym_id: 'a', commission_total: '4000.00', percentage_total: '4000.00', commission_payments: '8' }),
      row({ gym_id: 'b', commission_total: '0', held_total: '75000.00', held_payments: '9' }),
    ]);
    expect(s.total).toBe(4000);
    expect(s.held).toBe(75000);
    expect(s.heldPayments).toBe(9);
    // A gym that only holds float has earned nothing.
    expect(s.earningGyms).toBe(1);
    expect(s.payments).toBe(8);
  });

  it('keeps the percentage and flat halves separate and adding up', () => {
    const s = summarizeCommission([
      row({ gym_id: 'a', commission_total: 4000, percentage_total: 4000 }),
      row({ gym_id: 'b', commission_total: 1500, flat_total: 1500, commission_mode: 'fixed' }),
      row({ gym_id: 'c', commission_total: 300, unclassified_total: 300 }),
    ]);
    expect(s.fromPercentage).toBe(4000);
    expect(s.fromFlat).toBe(1500);
    expect(s.unclassified).toBe(300);
    expect(s.fromPercentage + s.fromFlat + s.unclassified).toBe(s.total);
  });

  it('caps the rendered list without capping the total', () => {
    const rows = Array.from({ length: 5 }, (_, i) => row({ gym_id: `g${i}`, commission_total: (i + 1) * 100 }));
    const s = summarizeCommission(rows, 2);
    // Totals are over everything: 100+200+300+400+500.
    expect(s.total).toBe(1500);
    // The list is the top two, and what it leaves out is reportable rather than lost.
    expect(s.rows.map((g) => g.commission)).toEqual([500, 400]);
    expect(s.hiddenGyms).toBe(3);
    expect(s.hiddenCommission).toBe(600);
    expect(s.hiddenCommission + s.rows.reduce((t, g) => t + g.commission, 0)).toBe(s.total);
  });
});

describe('rateLabel', () => {
  it('states the flat fee rather than deriving a rate from it', () => {
    // A ₦500 flat fee is not a percentage of anything; the fixed-mode gym still
    // carries a fallback pct (see 20260824090000) and rendering that would state
    // an arrangement the gym is not on.
    expect(rateLabel({ commission_mode: 'fixed', commission_pct: 5, commission_fixed_amount: 500 })).toBe('₦500 flat');
  });

  it('trims numeric(5,2) padding off a whole-number rate', () => {
    expect(rateLabel({ commission_mode: 'percentage', commission_pct: '20.00', commission_fixed_amount: 0 })).toBe('20%');
    expect(rateLabel({ commission_mode: 'percentage', commission_pct: '2.50', commission_fixed_amount: 0 })).toBe('2.50%');
  });
});

describe('commissionPeriod', () => {
  it('defaults to 30 days and accepts the offered windows', () => {
    const now = new Date('2026-08-20T00:00:00Z');
    expect(commissionPeriod(undefined, now).key).toBe('30');
    expect(commissionPeriod('nonsense', now).key).toBe('30');
    expect(commissionPeriod('all', now).from).toBeNull();
    expect(commissionPeriod('90', now).from?.toISOString()).toBe('2026-05-22T00:00:00.000Z');
  });
});

// Everything that describes a gym's deal in prose. Each of these used to read
// gyms.platform_commission_pct on its own, which in fixed mode is only the
// Paystack fallback — so a gym on ₦500 flat was told, and its owner was told,
// that it was on 5%.
describe('describing a gym’s arrangement', () => {
  const flat = { mode: 'fixed', pct: 5, fixed: 500 };
  const pctOnly = { mode: 'percentage', pct: 5, fixed: 0 };

  it('names the flat deal rather than the fallback rate', () => {
    expect(arrangementLabel(flat)).toBe('₦500 flat');
    expect(arrangementLabel(pctOnly)).toBe('5%');
    // A row that predates the mode column reads as the arrangement every gym
    // already has.
    expect(arrangementLabel({ pct: '7.50' })).toBe('7.50%');
  });

  it('estimates a flat deal per payment, not per naira', () => {
    // 400 payments, ₦10,000,000 GMV. The percentage reading of a ₦500-per-
    // payment deal was ₦500,000 against a real ₦200,000.
    const volume = { gmv: 10_000_000, payments: 400 };
    expect(estimatedCommission(flat, volume)).toBe(200_000);
    expect(estimatedCommission(pctOnly, volume)).toBe(500_000);
  });

  it('never calls a flat deal the default, whatever its fallback rate is', () => {
    // The fallback is left at the 5.00 default on most fixed-mode gyms, which
    // is exactly the gym an operator needs flagged as negotiated.
    expect(isDefaultArrangement(flat, 5)).toBe(false);
    expect(isDefaultArrangement(pctOnly, 5)).toBe(true);
    expect(isDefaultArrangement({ mode: 'percentage', pct: '5.00' }, 5)).toBe(true);
    expect(isDefaultArrangement({ mode: 'percentage', pct: 6 }, 5)).toBe(false);
  });
});

// The surfaces themselves: each must be reading the arrangement, not the rate.
describe('the pages that quote a gym’s commission', () => {
  it('the gym detail page prices the estimate off the arrangement', () => {
    const src = read('app/(superadmin)/superadmin/gyms/[id]/page.tsx');
    expect(src).toContain('estimatedCommission(arrangement');
    expect(src).toContain('arrangementLabel(arrangement)');
    // ...and neither the estimate nor the "why no commission" prose quotes the
    // bare percentage any more.
    expect(src).not.toMatch(/memberGmv \* \(Number\(gym\.platform_commission_pct/);
    expect(src).not.toMatch(/GymFlow earning \{Number\(gym\.platform_commission_pct/);
  });

  it('platform settings flags gyms by arrangement, not by rate', () => {
    const src = read('app/(superadmin)/superadmin/settings/page.tsx');
    expect(src).toContain('isDefaultArrangement(arrangementOf(g)');
    expect(src).toContain('arrangementLabel(arrangementOf(g))');
    // ...and it has to select the columns it now reads.
    expect(src).toContain('platform_commission_mode');
    expect(src).toContain('platform_commission_fixed_amount');
  });

  it('the gym owner is told the deal they are actually on', () => {
    // This one is shown to a paying customer, so quoting a rate GymFlow does
    // not charge them is the worst of the four.
    expect(read('app/(admin)/admin/settings/page.tsx')).toContain('commission_label: commissionLabel');
    expect(read('components/admin/payout-accounts.tsx')).toContain('meta.commission_label');
    expect(read('components/admin/payout-accounts.tsx')).not.toContain('commission_pct');
  });
});
