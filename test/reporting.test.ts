import { beforeAll, describe, expect, it } from 'vitest';
import { asSuperuser, withSession } from './db';
import { IDS, seed } from './seed';
import {
  parseGymReportingSummary, parsePlatformCommissionSummary, parsePlatformGymSummary, parseRosterPage,
} from '@/lib/reporting';

const BULK_MEMBERS = 1_105;
const BULK_GYMS = 1_025;
const ADMIN = '50000000-0000-4000-8000-000000000001';

const memberId = (n: number) => `30000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const summaryAs = (uid: string, gymId: string = IDS.gymA) =>
  withSession({ role: 'authenticated', uid }, async (client) => {
    const { rows } = await client.query<{ value: unknown }>(
      `select public.gym_reporting_summary($1) as value`, [gymId],
    );
    return parseGymReportingSummary(rows[0].value);
  });

const rosterAs = (
  uid: string,
  args: { gymId?: string; search?: string | null; filter?: string; offset?: number; limit?: number } = {},
) => withSession({ role: 'authenticated', uid }, async (client) => {
  const { rows } = await client.query<{ value: unknown }>(
    `select public.gym_member_roster($1, $2, $3, $4, $5) as value`,
    [args.gymId ?? IDS.gymA, args.search ?? null, args.filter ?? 'all', args.offset ?? 0, args.limit ?? 50],
  );
  return parseRosterPage(rows[0].value);
});

beforeAll(async () => {
  await seed();
  await asSuperuser(async (client) => {
    await client.query(`insert into auth.users (id, email) values ($1, 'report-admin@gymflow.ng')`, [ADMIN]);
    await client.query(
      `insert into public.platform_admins (user_id, name, email) values ($1, 'Report Admin', 'report-admin@gymflow.ng')`,
      [ADMIN],
    );
    await client.query(
      `insert into auth.users (id, email)
       select ('30000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
              'scale-' || g || '@example.com'
       from generate_series(1, $1) g`,
      [BULK_MEMBERS],
    );
    await client.query(
       `update public.profiles p
       set gym_id = $1,
           first_name = 'Scale',
           last_name = 'Match ' || right(p.id::text, 12)
       where p.id::text like '30000000-0000-0000-0000-%'`,
      [IDS.gymA],
    );
    await client.query(
      `insert into public.gym_member_links (gym_id, user_id, member_id, is_active, joined_at)
       select $1, p.id, p.id, true, now() - (right(p.id::text, 4)::int || ' seconds')::interval
       from public.profiles p
       where p.id::text like '30000000-0000-0000-0000-%'`,
      [IDS.gymA],
    );
    await client.query(
      `insert into public.member_subscriptions (gym_id, member_id, plan_id, status, start_date, end_date)
       select $1, p.id, $2, 'active',
              (now() at time zone 'Africa/Lagos')::date - 10,
              (now() at time zone 'Africa/Lagos')::date + 20
       from public.profiles p
       where p.id::text like '30000000-0000-0000-0000-%'`,
      [IDS.gymA, IDS.planA],
    );

    // Paid past-due access remains active, while future, paused and elapsed
    // rows are distinct staff-facing states.
    await client.query(
      `update public.member_subscriptions
       set status = case
             when member_id = $2 then 'past_due'
             when member_id = $4 then 'paused'
             else status
           end,
           start_date = case
             when member_id = $3 then (now() at time zone 'Africa/Lagos')::date + 3
             else start_date
           end,
           end_date = case
             when member_id = $3 then (now() at time zone 'Africa/Lagos')::date + 33
             when member_id = $5 then (now() at time zone 'Africa/Lagos')::date - 1
             else end_date
           end
       where gym_id = $1 and member_id = any (array[$2, $3, $4, $5]::uuid[])`,
      [IDS.gymA, memberId(1), memberId(2), memberId(3), memberId(4)],
    );
    // This historical row ends much later than the live past-due row. The live
    // status must still win deterministically.
    await client.query(
      `insert into public.member_subscriptions (gym_id, member_id, plan_id, status, start_date, end_date)
       values ($1, $2, $3, 'expired',
               (now() at time zone 'Africa/Lagos')::date - 100,
               (now() at time zone 'Africa/Lagos')::date + 1000)`,
      [IDS.gymA, memberId(1), IDS.planA],
    );

    await client.query(
      `insert into public.payments
         (gym_id, member_id, amount, currency, status, payment_status, paystack_reference, payment_date)
       select $1, p.id, 100, 'NGN', 'success', 'successful', 'report-scale-' || right(p.id::text, 12), now()
       from public.profiles p
       where p.id::text like '30000000-0000-0000-0000-%'`,
      [IDS.gymA],
    );
    await client.query(
      `insert into public.payments
         (gym_id, member_id, amount, refunded_amount, currency, status, payment_status, paystack_reference, payment_date)
       values ($1, $2, 1000, 250, 'NGN', 'success', 'successful', 'report-partial-refund', now())`,
      [IDS.gymA, IDS.memberA],
    );
    await client.query(
      `insert into public.check_ins (gym_id, member_id, check_in_method, checked_in_at)
       select $1, p.id, 'manual', now()
       from public.profiles p
       where p.id::text like '30000000-0000-0000-0000-%'
         and p.id not in ($2, $3, $4)`,
      [IDS.gymA, memberId(2), memberId(3), memberId(4)],
    );

    await client.query(
      `insert into public.gyms (id, slug, name, subscription_status, subscription_plan, subscription_billing_cycle)
       select ('40000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
              'report-gym-' || g,
              'Report Gym ' || g,
              case when g % 3 = 0 then 'past_due' else 'active' end,
              case when g % 2 = 0 then 'starter' else 'growth' end,
              case when g % 3 = 0 then 'annually' when g % 3 = 1 then 'monthly' else 'quarterly' end
       from generate_series(1, $1) g`,
      [BULK_GYMS],
    );
    await client.query(
      `insert into public.payments
         (gym_id, amount, currency, status, payment_status, paystack_reference, payment_date,
          platform_settlement, platform_commission_pct, platform_commission_amount, platform_commission_basis)
       select g.id, 1000, 'NGN', 'success', 'successful', 'commission-scale-' || g.id, now(),
              'split', 1, 10, 'percentage'
       from public.gyms g
       where g.id::text like '40000000-0000-0000-0000-%'`,
    );
  });
}, 60_000);

describe('gym_reporting_summary', () => {
  it('aggregates more than the PostgREST row cap without dropping money or visits', async () => {
    const summary = await summaryAs(IDS.ownerA);
    const expected = await asSuperuser(async (client) => {
      const { rows } = await client.query<{
        revenue: string;
        visits: string;
      }>(
        `select
           (select coalesce(sum(amount-refunded_amount), 0) from public.payments
             where gym_id = $1 and payment_status = 'successful'
               and payment_date >= ((((now() at time zone 'Africa/Lagos')::date - 29)::timestamp) at time zone 'Africa/Lagos')) as revenue,
           (select count(*) from public.check_ins
             where gym_id = $1
               and checked_in_at >= ((((now() at time zone 'Africa/Lagos')::date - 6)::timestamp) at time zone 'Africa/Lagos')) as visits`,
        [IDS.gymA],
      );
      return rows[0];
    });

    expect(summary.revenue30d).toBe(Number(expected.revenue));
    expect(summary.checkins7d).toBe(Number(expected.visits));
    expect(summary.revenue30d).toBeGreaterThan(100_000);
    expect(summary.checkins7d).toBeGreaterThan(1_000);
  });

  it('uses the WAT inclusive access rule for counts and plan mix', async () => {
    const summary = await summaryAs(IDS.ownerA);
    expect(summary.activeAccess).toBeGreaterThan(1_000);
    expect(summary.scheduled).toBe(1);
    expect(summary.frozen).toBe(1);
    expect(summary.lapsed).toBe(1);
    expect(summary.planMix.reduce((sum, plan) => sum + plan.total, 0)).toBe(summary.activeAccess);
  });

  it('stays tenant-scoped under the caller and is unavailable to anon', async () => {
    const own = await summaryAs(IDS.ownerA, IDS.gymA);
    expect(own.roster).toBeGreaterThan(1_000);
    const other = await withSession({ role: 'authenticated', uid: IDS.ownerA }, async (client) => {
      try { await client.query(`select public.gym_reporting_summary($1)`, [IDS.gymB]); return null; }
      catch (caught) { return caught as { code?: string }; }
    });
    expect(other?.code).toBe('42501');

    const error = await withSession({ role: 'anon' }, async (client) => {
      try { await client.query(`select public.gym_reporting_summary($1)`, [IDS.gymA]); return null; }
      catch (caught) { return caught as { code?: string }; }
    });
    expect(error?.code).toMatch(/^42(501|883)$/);

    const unverified = await withSession({ role: 'authenticated', uid: IDS.ownerA, verified: false }, async (client) => {
      try { await client.query(`select public.gym_reporting_summary($1)`, [IDS.gymA]); return null; }
      catch (caught) { return caught as { code?: string }; }
    });
    expect(unverified?.code).toBe('42501');
  });
});

describe('gym_member_roster', () => {
  it('searches and paginates the full tenant roster past 1000 matching ids', async () => {
    const first = await rosterAs(IDS.ownerA, { search: 'Scale Match', offset: 0, limit: 50 });
    const afterCap = await rosterAs(IDS.ownerA, { search: 'Scale Match', offset: 1_000, limit: 50 });
    const tail = await rosterAs(IDS.ownerA, { search: 'Scale Match', offset: 1_100, limit: 50 });
    expect(first.total).toBe(BULK_MEMBERS);
    expect(first.rows).toHaveLength(50);
    expect(afterCap.total).toBe(BULK_MEMBERS);
    expect(afterCap.rows).toHaveLength(50);
    expect(tail.rows).toHaveLength(5);
  });

  it('prioritizes the current live row and exposes canonical staff states', async () => {
    const pastDue = await rosterAs(IDS.ownerA, { search: 'scale-1@example.com' });
    const scheduled = await rosterAs(IDS.ownerA, { search: 'scale-2@example.com' });
    const frozen = await rosterAs(IDS.ownerA, { search: 'scale-3@example.com' });
    const expired = await rosterAs(IDS.ownerA, { search: 'scale-4@example.com' });
    expect(pastDue.rows[0]).toMatchObject({ subscriptionStatus: 'past_due', displayState: 'active' });
    expect(scheduled.rows[0]).toMatchObject({ displayState: 'scheduled' });
    expect(frozen.rows[0]).toMatchObject({ displayState: 'frozen' });
    expect(expired.rows[0]).toMatchObject({ displayState: 'expired' });
  });

  it('applies state filters before pagination and cannot search another gym', async () => {
    const scheduled = await rosterAs(IDS.ownerA, { filter: 'scheduled' });
    expect(scheduled.total).toBe(1);
    expect(scheduled.rows[0].memberId).toBe(memberId(2));
    const other = await withSession({ role: 'authenticated', uid: IDS.ownerA }, async (client) => {
      try {
        await client.query(`select public.gym_member_roster($1, $2, 'all', 0, 50)`, [IDS.gymB, 'memberB']);
        return null;
      } catch (caught) { return caught as { code?: string }; }
    });
    expect(other?.code).toBe('42501');
  });
});

describe('platform_gym_summary', () => {
  it('counts and groups more than 1000 gyms without fetching their rows', async () => {
    const summary = await withSession({ role: 'authenticated', uid: ADMIN }, async (client) => {
      const { rows } = await client.query<{ value: unknown }>(`select public.platform_gym_summary() as value`);
      return parsePlatformGymSummary(rows[0].value);
    });
    const expectedGyms = await asSuperuser(async (client) =>
      Number((await client.query<{ total: string }>(`select count(*) as total from public.gyms`)).rows[0].total));
    expect(summary.gyms).toBe(expectedGyms);
    expect(summary.gyms).toBeGreaterThan(1_000);
    expect(summary.activePlanMix.reduce((sum, group) => sum + group.total, 0)).toBe(summary.activeGyms);
  });

  it('rolls more than 1000 per-gym commission rows into complete totals and a stated display cap', async () => {
    const summary = await withSession({ role: 'authenticated', uid: ADMIN }, async (client) => {
      const { rows } = await client.query<{ value: unknown }>(
        `select public.platform_commission_summary(null, null, 50) as value`,
      );
      return parsePlatformCommissionSummary(rows[0].value);
    });
    expect(summary.earningGyms).toBeGreaterThan(1_000);
    expect(summary.total).toBeGreaterThanOrEqual(BULK_GYMS * 10);
    expect(summary.rows).toHaveLength(50);
    expect(summary.hiddenGyms).toBeGreaterThan(950);
    expect(summary.hiddenCommission).toBe(summary.total - summary.rows.reduce((sum, row) => sum + row.commission, 0));
  });

  it('returns exact per-gym member counts above the row cap', async () => {
    const count = await withSession({ role: 'authenticated', uid: ADMIN }, async (client) => {
      const { rows } = await client.query<{ member_count: string }>(
        `select member_count from public.platform_gym_member_counts(array[$1]::uuid[])`, [IDS.gymA],
      );
      return Number(rows[0].member_count);
    });
    expect(count).toBe(BULK_MEMBERS + 1);
  });
});

describe('reporting payload validation', () => {
  it('fails visibly on incomplete aggregate payloads', () => {
    expect(() => parseGymReportingSummary({})).toThrow(/invalid number/);
    expect(() => parseRosterPage({ total: 1, rows: null })).toThrow(/invalid list/);
    expect(() => parsePlatformGymSummary(null)).toThrow(/invalid payload/);
    expect(() => parsePlatformCommissionSummary({ rows: [] })).toThrow(/invalid number/);
  });
});
