import { beforeAll, describe, expect, it } from 'vitest';
import { asSuperuser, withSession } from './db';
import { IDS, seed } from './seed';
import { watMonthStartISO } from '../lib/format';
import { monthLabel, parseRevenueSummary } from '../lib/platform-revenue';

// public.platform_revenue_summary replaced summing fetched rows in
// /superadmin and /superadmin/revenue. PostgREST caps a response at max-rows,
// so those totals froze once there were more than 1000 payments.

const ADMIN = 'ad000000-0000-0000-0000-0000000000d1';
const EXTRA_PAYMENTS = 1100;

const summaryAs = (uid: string) =>
  withSession({ role: 'authenticated', uid }, async (c) => {
    const { rows } = await c.query<{ s: unknown }>(`select public.platform_revenue_summary(12) as s`);
    return parseRevenueSummary(rows[0].s);
  });

const superSum = (sql: string, params: unknown[] = []) =>
  asSuperuser(async (c) => Number((await c.query<{ n: string }>(sql, params)).rows[0].n));

beforeAll(async () => {
  await seed();
  await asSuperuser(async (c) => {
    await c.query(`delete from public.platform_admins where user_id = $1`, [ADMIN]);
    await c.query(`delete from auth.users where id = $1`, [ADMIN]);
    await c.query(`insert into auth.users (id, email) values ($1, $2)`, [ADMIN, 'rev-ops@gymflow.ng']);
    await c.query(`insert into public.platform_admins (user_id, name, email) values ($1, 'Rev Ops', 'rev-ops@gymflow.ng')`, [ADMIN]);

    // More rows than PostgREST's max-rows, so a fetched-and-summed total would be short.
    await c.query(
      `insert into public.payments (gym_id, amount, currency, status, payment_status, paystack_reference)
       select $1, 100, 'NGN', 'success', 'successful', 'rev-bulk-' || g from generate_series(1, $2) g`,
      [IDS.gymA, EXTRA_PAYMENTS],
    );

    // 00:30 WAT on the 1st is still the previous day in UTC. It belongs to this month.
    await c.query(
      `insert into public.payments (gym_id, amount, currency, status, payment_status, paystack_reference, payment_date)
       values ($1, 777, 'NGN', 'paid', 'successful', 'rev-wat-edge',
               (date_trunc('month', now() at time zone 'Africa/Lagos') + interval '30 minutes') at time zone 'Africa/Lagos')`,
      [IDS.gymA],
    );

    await c.query(
      `insert into public.platform_payments (gym_id, amount, payment_status, billing_period_start, billing_period_end)
       values ($1, 25000, 'successful', $2::date, $2::date + 30),
              ($1, 60000, 'successful', $2::date - 400, $2::date - 370)`,
      [IDS.gymA, watMonthStartISO()],
    );
  });
});

describe('platform_revenue_summary', () => {
  it('totals every payment, past the 1000-row cap', async () => {
    const s = await summaryAs(ADMIN);
    const rows = await superSum(`select count(*) as n from public.payments where payment_status = 'successful'`);
    expect(rows).toBeGreaterThan(1000);
    expect(s.memberGmv).toBe(await superSum(`select coalesce(sum(amount), 0) as n from public.payments where payment_status = 'successful'`));
    expect(s.platformAllTime).toBe(await superSum(`select coalesce(sum(amount), 0) as n from public.platform_payments where payment_status = 'successful'`));
  });

  it('buckets by WAT month, ending with the current one', async () => {
    const s = await summaryAs(ADMIN);
    expect(s.memberMonthly).toHaveLength(12);
    expect(s.platformMonthly).toHaveLength(12);
    const current = watMonthStartISO().slice(0, 7);
    expect(s.memberMonthly.at(-1)?.month).toBe(current);

    const thisMonth = await superSum(
      `select coalesce(sum(amount), 0) as n from public.payments
       where status = any (array['success','successful','completed','paid'])
         and payment_date >= ($1::date::timestamp at time zone 'Africa/Lagos')`,
      [watMonthStartISO()],
    );
    expect(s.memberMonthly.at(-1)?.total).toBe(thisMonth);
    expect(thisMonth).toBeGreaterThanOrEqual(777);

    // The 400-day-old platform charge is outside the 12 buckets but inside all-time.
    expect(s.platformThisMonth).toBe(await superSum(
      `select coalesce(sum(amount), 0) as n from public.platform_payments
       where payment_status = 'successful' and billing_period_start >= $1::date`,
      [watMonthStartISO()],
    ));
    expect(s.platformMonthly.reduce((a, m) => a + m.total, 0)).toBeLessThan(s.platformAllTime);
  });

  it('runs as the caller: a gym owner only sees their own gym through RLS', async () => {
    const s = await summaryAs(IDS.ownerA);
    expect(s.memberGmv).toBe(await superSum(
      `select coalesce(sum(amount), 0) as n from public.payments where payment_status = 'successful' and gym_id = $1`,
      [IDS.gymA],
    ));
    const all = await superSum(`select coalesce(sum(amount), 0) as n from public.payments where payment_status = 'successful'`);
    expect(s.memberGmv).toBeLessThan(all);
  });

  it('is not callable by anon', async () => {
    const err = await withSession({ role: 'anon' }, async (c) => {
      try { await c.query(`select public.platform_revenue_summary(12)`); return null; } catch (e) { return e as { code?: string }; }
    });
    expect(err?.code).toMatch(/^42(501|883)$/);
  });
});

describe('parseRevenueSummary / monthLabel', () => {
  it('reads numeric strings and tolerates a missing payload', () => {
    const s = parseRevenueSummary({ member_gmv: '1234.50', member_monthly: [{ month: '2026-09', total: '10' }] });
    expect(s.memberGmv).toBe(1234.5);
    expect(s.memberMonthly).toEqual([{ month: '2026-09', total: 10 }]);
    expect(parseRevenueSummary(null).platformAllTime).toBe(0);
  });

  it('labels a month key without a timezone shift', () => {
    expect(monthLabel('2026-01')).toBe('Jan');
    expect(monthLabel('2026-12')).toBe('Dec');
  });
});
