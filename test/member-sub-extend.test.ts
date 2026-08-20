import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PoolClient } from 'pg';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asSuperuser, pool, withSession } from './db';
import { IDS, seed } from './seed';
import { LIVE_SUB_STATUSES, extendMemberSub, grantMemberPeriod } from '@/lib/member-sub-core';
import { extendDate } from '@/lib/plan-duration';

// Renewing a membership is money changing hands, so the two ways it used to go
// wrong are both reproduced here against the real migrations-built database:
//
//   1. Three writers (one-off card renewal, auto-debit cycle, front-desk cash)
//      each read end_date, added the period in JavaScript and wrote the result
//      back. Two payments settling at the same instant both read the same date,
//      both computed the same one, and the second write threw a paid period
//      away. extend_member_sub() does the arithmetic inside the UPDATE.
//   2. On the INSERT side both writers could conclude "this member has no
//      subscription" and both insert, leaving two live rows (and two mirrored
//      memberships) for two payments and one period of access.
//      member_subscriptions_one_live_idx makes that unrepresentable.
//
// The arithmetic cases come first: moving a renewal's date maths from
// TypeScript into SQL is only safe if it is the SAME maths, and "the fix
// repriced every renewal" would be a worse bug than the one being fixed.

const root = (...p: string[]) => resolve(__dirname, '..', ...p);
const read = (path: string) => readFileSync(root(path), 'utf8');
const ONE_LIVE_MIGRATION = 'supabase/migrations/20260821093000_one_live_member_sub.sql';

type Period = { duration_days: number | null; duration_months: number | null };

async function newSub(endDate: string, extra: { status?: string; autoDebit?: boolean; code?: string | null } = {}): Promise<string> {
  return asSuperuser(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into public.member_subscriptions
         (gym_id, member_id, plan_id, start_date, end_date, status, auto_debit_enabled, paystack_subscription_code)
       values ($1, $2, $3, current_date, $4, $5, $6, $7) returning id`,
      [IDS.gymA, IDS.memberA, IDS.planA, endDate, extra.status ?? 'active', extra.autoDebit ?? false, extra.code ?? null],
    );
    return rows[0].id;
  });
}

async function endDateOf(subId: string): Promise<string> {
  return asSuperuser(async (c) => {
    const { rows } = await c.query<{ end_date: Date }>(`select end_date from public.member_subscriptions where id = $1`, [subId]);
    return rows[0].end_date.toISOString().slice(0, 10);
  });
}

// Put a subscription into the state freezeMembership/approveFreeze leave behind:
// paused with an explicit window, which is what resumeFreeze reads to work out
// how many days the member is owed.
async function freeze(subId: string, start: string, end: string): Promise<void> {
  await asSuperuser((c) => c.query(
    `update public.member_subscriptions
        set paused_at = now(), pause_start = $2, pause_end = $3
      where id = $1`,
    [subId, start, end],
  ));
}

async function frozenState(subId: string) {
  return asSuperuser(async (c) => {
    const { rows } = await c.query<{
      status: string; pause_start: Date | null; pause_end: Date | null; paused_at: Date | null; end_date: Date;
    }>(
      `select status, pause_start, pause_end, paused_at, end_date from public.member_subscriptions where id = $1`,
      [subId],
    );
    const r = rows[0];
    return {
      status: r.status,
      pause_start: r.pause_start?.toISOString().slice(0, 10) ?? null,
      pause_end: r.pause_end?.toISOString().slice(0, 10) ?? null,
      paused: r.paused_at !== null,
      end_date: r.end_date.toISOString().slice(0, 10),
    };
  });
}

// What lib/plan-duration.ts would have produced for the same inputs.
const inJs = (from: string, p: Period) => extendDate(new Date(from), p).toISOString().slice(0, 10);

// The two-connection tests hold open transactions. Roll them back before the
// clients go home: a failed assertion mid-transaction would otherwise return a
// poisoned client to the shared pool and fail every test after it for the
// wrong reason.
async function release(...clients: PoolClient[]): Promise<void> {
  for (const c of clients) {
    try { await c.query('rollback'); } catch { /* already committed or dead */ }
    c.release();
  }
}

describe('the renewal period, in SQL', () => {
  beforeAll(async () => { await seed(); });

  // Every shape a plan can take, plus the two month-ends that separate the
  // JavaScript rule from Postgres' own. `date + interval '1 month'` CLAMPS
  // (31 Jan → 28 Feb) while Date.setMonth() OVERFLOWS (31 Jan → 3 Mar), so a
  // naive translation would quietly shorten every renewal that lands on a long
  // month's tail — three days of access per member, per cycle, forever.
  const CASES: Array<{ from: string; period: Period }> = [
    { from: '2027-08-20', period: { duration_days: null, duration_months: 1 } },
    { from: '2027-08-20', period: { duration_days: null, duration_months: 3 } },
    { from: '2027-08-20', period: { duration_days: null, duration_months: 12 } },
    { from: '2027-08-20', period: { duration_days: 1, duration_months: 0 } },
    { from: '2027-08-20', period: { duration_days: 7, duration_months: 0 } },
    { from: '2027-08-20', period: { duration_days: 14, duration_months: 1 } }, // days win over months
    { from: '2027-01-31', period: { duration_days: null, duration_months: 1 } }, // overflow, not clamp
    { from: '2027-03-31', period: { duration_days: null, duration_months: 1 } },
    { from: '2027-08-31', period: { duration_days: null, duration_months: 6 } },
    { from: '2027-12-31', period: { duration_days: null, duration_months: 2 } },
    { from: '2027-08-20', period: { duration_days: null, duration_months: 0 } },    // floors at one month
    { from: '2027-08-20', period: { duration_days: null, duration_months: null } }, // …and so does "unset"
  ];

  it('lands on the same day as extendDate() for every plan shape', async () => {
    for (const { from, period } of CASES) {
      const sql = await asSuperuser(async (c) => {
        const { rows } = await c.query<{ e: Date }>(
          `select private.period_end($1::date, $2::int, $3::int) as e`,
          [from, period.duration_days, period.duration_months],
        );
        return rows[0].e.toISOString().slice(0, 10);
      });
      expect(sql, `${from} + ${JSON.stringify(period)}`).toBe(inJs(from, period));
    }
  });
});

describe('extend_member_sub', () => {
  beforeAll(async () => { await seed(); });
  beforeEach(async () => {
    await asSuperuser((c) => c.query(`delete from public.member_subscriptions where member_id = $1`, [IDS.memberA]));
  });

  const extend = (client: { query: typeof pool.query }, subId: string, period: Period) =>
    client.query<{ e: Date | null }>(
      `select public.extend_member_sub($1::uuid, $2::int, $3::int) as e`,
      [subId, period.duration_days, period.duration_months],
    );

  it('stacks onto a period that is still running', async () => {
    const subId = await newSub('2027-06-01');
    const got = await asSuperuser((c) => extend(c, subId, { duration_days: null, duration_months: 1 }));
    expect(got.rows[0].e?.toISOString().slice(0, 10)).toBe('2027-07-01');
    expect(await endDateOf(subId)).toBe('2027-07-01');
  });

  it('starts from today when the period already lapsed, never from the stale date', async () => {
    const subId = await newSub('2020-01-01');
    await asSuperuser((c) => extend(c, subId, { duration_days: 7, duration_months: 0 }));
    // renewalBase(): a lapsed period loses to today, so the member gets a full
    // week from now rather than a week from 2020.
    expect(await endDateOf(subId)).toBe(inJs(new Date().toISOString().slice(0, 10), { duration_days: 7, duration_months: null }));
  });

  it('leaves a frozen row frozen — the payment buys time, it does not end the freeze', async () => {
    // The flip to 'active' is right for every OTHER status (a payment landing
    // is exactly what should recover a past_due member), but a frozen row that
    // came back active while still carrying its pause window could never be
    // resumed or approved again — see the describe below for the whole path.
    const subId = await newSub('2027-06-01', { status: 'paused' });
    await freeze(subId, '2026-08-10', '2026-09-09');
    await asSuperuser((c) => extend(c, subId, { duration_days: null, duration_months: 1 }));
    expect(await frozenState(subId)).toEqual({
      status: 'paused', pause_start: '2026-08-10', pause_end: '2026-09-09', paused: true, end_date: '2027-07-01',
    });
  });

  it('recovers a past_due row to active, and returns nothing for an id it cannot update', async () => {
    const subId = await newSub('2027-06-01', { status: 'past_due' });
    await asSuperuser((c) => extend(c, subId, { duration_days: null, duration_months: 1 }));
    const status = await asSuperuser(async (c) => {
      const { rows } = await c.query<{ status: string }>(`select status from public.member_subscriptions where id = $1`, [subId]);
      return rows[0].status;
    });
    expect(status).toBe('active');

    // No row updated → no date back. extendMemberSub() turns that into a
    // failure rather than reporting an extension that never happened.
    const missing = await asSuperuser((c) => extend(c, '00000000-0000-0000-0000-000000000000', { duration_days: null, duration_months: 1 }));
    expect(missing.rows[0].e).toBeNull();
  });

  // The defect, reproduced: two writers, two references, two months paid.
  it('two concurrent renewals grant two periods', async () => {
    const subId = await newSub('2027-06-01');
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query('begin');
      await b.query('begin');
      // A extends and holds the row lock without committing.
      const first = await extend(a, subId, { duration_days: null, duration_months: 1 });
      expect(first.rows[0].e?.toISOString().slice(0, 10)).toBe('2027-07-01');
      // B now blocks on A's uncommitted row. Deliberately not awaited yet —
      // this is the interleaving that used to lose a month.
      const second = extend(b, subId, { duration_days: null, duration_months: 1 });
      await a.query('commit');
      // Postgres re-reads the row A committed and re-evaluates the SET
      // expression against it, so B stacks instead of overwriting.
      expect((await second).rows[0].e?.toISOString().slice(0, 10)).toBe('2027-08-01');
      await b.query('commit');
    } finally {
      await release(a, b);
    }
    expect(await endDateOf(subId)).toBe('2027-08-01');
  });

  it('…where the read-modify-write it replaces granted only one', async () => {
    // The shape all three writers used: SELECT end_date → compute in JS →
    // UPDATE ... WHERE id. Kept as a test so the difference above is visible
    // and not merely asserted. Rolled back — this is a demonstration, not state.
    const subId = await newSub('2027-06-01');
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query('begin');
      await b.query('begin');
      const readEnd = async (c: typeof a) => {
        const { rows } = await c.query<{ end_date: Date }>(`select end_date from public.member_subscriptions where id = $1`, [subId]);
        return rows[0].end_date.toISOString().slice(0, 10);
      };
      // Both read before either writes — the whole problem in one line.
      const [aEnd, bEnd] = [await readEnd(a), await readEnd(b)];
      const write = (c: typeof a, from: string) => c.query(
        `update public.member_subscriptions set end_date = $2 where id = $1`,
        [subId, inJs(from, { duration_days: null, duration_months: 1 })],
      );
      await write(a, aEnd);
      const bWrite = write(b, bEnd);
      await a.query('commit');
      await bWrite;
      await b.query('commit');
    } finally {
      await release(a, b);
    }
    expect(await endDateOf(subId)).toBe('2027-07-01'); // two payments, one month
  });
});

describe('one live subscription per member per gym', () => {
  beforeAll(async () => { await seed(); });
  beforeEach(async () => {
    await asSuperuser((c) => c.query(`delete from public.member_subscriptions where member_id = $1`, [IDS.memberA]));
  });

  it('refuses a second live row — the racing INSERT that used to succeed', async () => {
    await newSub('2027-06-01');
    await expect(newSub('2027-06-01')).rejects.toMatchObject({ code: '23505' });
  });

  it('refuses it across the live statuses, not just active-vs-active', async () => {
    await newSub('2027-06-01', { status: 'paused' });
    for (const status of LIVE_SUB_STATUSES) {
      await expect(newSub('2027-06-01', { status })).rejects.toMatchObject({ code: '23505' });
    }
  });

  it('still allows the history: expired and cancelled rows stack up freely', async () => {
    await newSub('2020-01-01', { status: 'expired' });
    await newSub('2021-01-01', { status: 'cancelled' });
    await newSub('2022-01-01', { status: 'expired' });
    await expect(newSub('2027-06-01')).resolves.toBeTruthy();
  });

  it('is scoped per gym, so one person can train at two gyms', async () => {
    await newSub('2027-06-01');
    await expect(asSuperuser((c) => c.query(
      `insert into public.member_subscriptions (gym_id, member_id, start_date, end_date, status)
       values ($1, $2, current_date, '2027-06-01', 'active')`,
      [IDS.gymB, IDS.memberA],
    ))).resolves.toBeTruthy();
  });

  it('covers exactly the statuses LIVE_SUB_STATUSES names', async () => {
    // The constant and the index predicate are two spellings of one rule; the
    // fallback re-read after a 23505 uses the constant to find the row the
    // index just protected, so a drift between them silently reopens the race.
    const predicate = await asSuperuser(async (c) => {
      const { rows } = await c.query<{ indexdef: string }>(
        `select indexdef from pg_indexes where indexname = 'member_subscriptions_one_live_idx'`,
      );
      return rows[0].indexdef;
    });
    for (const status of LIVE_SUB_STATUSES) expect(predicate).toContain(`'${status}'`);
    expect(predicate.match(/'[a-z_]+'::text/g)).toHaveLength(LIVE_SUB_STATUSES.length);
  });
});

describe('the migration that installs it survives live duplicates', () => {
  // The reason this test exists: the index ships to a production database that
  // may ALREADY hold the duplicate rows it forbids, and a CREATE UNIQUE INDEX
  // that aborts halfway through a deploy is its own outage. So the real
  // migration file is re-applied here against data that violates it.
  beforeAll(async () => { await seed(); });

  it('collapses duplicate live rows and then indexes them', async () => {
    const rows = await asSuperuser(async (c) => {
      await c.query('begin');
      try {
        await c.query(`delete from public.member_subscriptions where member_id = $1`, [IDS.memberA]);
        await c.query(`drop index public.member_subscriptions_one_live_idx`);
        const ids = [];
        for (const [end, status, autoDebit, code] of [
          ['2027-01-01', 'active', false, null],
          ['2027-03-01', 'past_due', false, null],
          ['2027-02-01', 'active', true, 'SUB_live'],
        ] as const) {
          const { rows: r } = await c.query<{ id: string }>(
            `insert into public.member_subscriptions
               (gym_id, member_id, start_date, end_date, status, auto_debit_enabled, paystack_subscription_code)
             values ($1, $2, current_date, $3, $4, $5, $6) returning id`,
            [IDS.gymA, IDS.memberA, end, status, autoDebit, code],
          );
          ids.push(r[0].id);
        }

        await c.query(read(ONE_LIVE_MIGRATION));

        const { rows: after } = await c.query<{ id: string; status: string; end_date: Date; auto_debit_enabled: boolean }>(
          `select id, status, end_date, auto_debit_enabled from public.member_subscriptions
            where member_id = $1 order by created_at`,
          [IDS.memberA],
        );
        const { rows: audit } = await c.query<{ record_id: string; new_values: Record<string, unknown> }>(
          `select record_id, new_values from public.audit_logs
            where action = 'duplicate_live_subscription_collapsed' order by record_id`,
        );
        return { ids, after, audit };
      } finally { await c.query('rollback'); }
    });

    const byId = new Map(rows.after.map((r) => [r.id, r]));
    const [oldest, furthest, mandate] = rows.ids;
    // The row carrying the live Paystack mandate survives: cancelling it would
    // leave that mandate charging a card with no live row to credit.
    expect(byId.get(mandate)).toMatchObject({ status: 'active', auto_debit_enabled: true });
    // …and it takes the group's furthest end_date, so collapsing can only move
    // a member's access forward.
    expect(byId.get(mandate)!.end_date.toISOString().slice(0, 10)).toBe('2027-03-01');
    for (const id of [oldest, furthest]) {
      expect(byId.get(id)).toMatchObject({ status: 'cancelled', auto_debit_enabled: false });
    }
    // Two payments and one period is usually what a duplicate pair means, so
    // the collapse is recorded rather than silent — that audit row is how an
    // operator finds the members who are owed time.
    expect(rows.audit.map((a) => a.record_id).sort()).toEqual([oldest, furthest].sort());
    expect(rows.audit[0].new_values).toMatchObject({ kept_subscription_id: mandate, kept_end_date: '2027-03-01' });
  });

  it('is idempotent — a second run with nothing to collapse changes nothing', async () => {
    await asSuperuser(async (c) => {
      await c.query('begin');
      try {
        const before = await c.query(`select count(*) from public.audit_logs where action = 'duplicate_live_subscription_collapsed'`);
        await c.query(read(ONE_LIVE_MIGRATION));
        const after = await c.query(`select count(*) from public.audit_logs where action = 'duplicate_live_subscription_collapsed'`);
        expect(after.rows[0]).toEqual(before.rows[0]);
      } finally { await c.query('rollback'); }
    });
  });
});

describe('every writer that extends a membership goes through the RPC', () => {
  // Source locks, in the spirit of test/commission-record.test.ts: the fix is
  // only worth anything while all three writers use it, and the fourth way to
  // renew a membership is exactly the kind of thing that gets added later with
  // a fresh read-modify-write in it.
  const WRITERS = [
    ['lib/paystack-fulfill.ts', 'grantMemberPeriod('],      // one-off card renewal
    ['lib/member-sub-fulfill.ts', 'extendMemberSub('],      // auto-debit cycle
    ['lib/actions/admin-member.ts', 'grantMemberPeriod('],  // front-desk cash
  ] as const;

  it('calls it instead of computing an end date and writing it back', () => {
    for (const [file, call] of WRITERS) {
      const src = read(file);
      expect(src, `${file} must extend through lib/member-sub-core.ts`).toContain(call);
      // No `update({ end_date: … })` anywhere in these files: that shape is the
      // defect, whatever value it is given.
      expect(src.match(/update\(\{[^}]*end_date/), `${file} must not write a computed end_date back`).toBeNull();
    }
  });

  it('and the RPC is the only place the arithmetic lives', () => {
    // extendDate/renewalBase still exist — the renew UI previews a coverage
    // window with them — but no fulfilment path may use them to write a row.
    for (const [file] of WRITERS) {
      expect(read(file).includes('extendDate('), `${file} must not re-implement the period`).toBe(false);
    }
    expect(read('lib/member-sub-core.ts')).toContain("rpc('extend_member_sub'");
  });
});

describe('extend_member_sub answers to RLS, not to whoever calls it', () => {
  beforeAll(async () => { await seed(); });
  beforeEach(async () => {
    await asSuperuser((c) => c.query(`delete from public.member_subscriptions where member_id = $1`, [IDS.memberA]));
  });

  it('extends for staff of the gym that owns the subscription', async () => {
    const subId = await newSub('2027-06-01');
    const got = await withSession({ role: 'authenticated', uid: IDS.ownerA, commit: true }, async (c) => {
      const { rows } = await c.query<{ e: Date | null }>(`select public.extend_member_sub($1::uuid, null, 1) as e`, [subId]);
      return rows[0].e;
    });
    expect(got?.toISOString().slice(0, 10)).toBe('2027-07-01');
  });

  it('does nothing for the member themselves, or for another gym’s staff', async () => {
    // SECURITY INVOKER is the whole point: a DEFINER version granted to
    // `authenticated` would be a free membership extension for anyone who could
    // guess a subscription id.
    const subId = await newSub('2027-06-01');
    for (const uid of [IDS.memberA, IDS.ownerB]) {
      const got = await withSession({ role: 'authenticated', uid }, async (c) => {
        const { rows } = await c.query<{ e: Date | null }>(`select public.extend_member_sub($1::uuid, null, 1) as e`, [subId]);
        return rows[0].e;
      });
      expect(got, `uid ${uid} must not be able to extend`).toBeNull();
    }
    expect(await endDateOf(subId)).toBe('2027-06-01');
  });
});

// A PostgREST-shaped façade over the REAL test database, just wide enough for
// grantMemberPeriod's four calls. Nothing here fakes Postgres — every call runs
// against gymflow_test, including the unique index — it stands in for
// supabase-js, which this suite has no HTTP server for. It exists so the 23505
// branch (what a writer does when a concurrent one wins the INSERT) is
// exercised rather than merely read.
function pgrest(client: PoolClient) {
  return {
    from(table: string) {
      const where: string[] = [];
      const params: unknown[] = [];
      let tail = '';
      const b = {
        select: () => b,
        eq(col: string, v: unknown) { params.push(v); where.push(`${col} = $${params.length}`); return b; },
        in(col: string, vs: readonly unknown[]) { params.push([...vs]); where.push(`${col} = any($${params.length})`); return b; },
        order(col: string, o: { ascending: boolean }) { tail += ` order by ${col} ${o.ascending ? 'asc' : 'desc'}`; return b; },
        limit(n: number) { tail += ` limit ${n}`; return b; },
        async maybeSingle() {
          const { rows } = await client.query(`select * from public.${table} where ${where.join(' and ')}${tail}`, params);
          return { data: rows[0] ?? null, error: null };
        },
        async insert(row: Record<string, unknown>) {
          const cols = Object.keys(row);
          try {
            await client.query(
              `insert into public.${table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
              Object.values(row),
            );
            return { error: null };
          } catch (e) { return { error: e as { code?: string; message: string } }; }
        },
      };
      return b;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      const names = Object.keys(args);
      try {
        const { rows } = await client.query(
          `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as v`,
          Object.values(args),
        );
        const v = rows[0].v as Date | null;
        return { data: v ? v.toISOString().slice(0, 10) : null, error: null };
      } catch (e) { return { data: null, error: e as { message: string } }; }
    },
  };
}

describe('grantMemberPeriod', () => {
  beforeAll(async () => { await seed(); });
  beforeEach(async () => {
    await asSuperuser((c) => c.query(`delete from public.member_subscriptions where member_id = $1`, [IDS.memberA]));
  });

  const MONTH = { duration_days: null, duration_months: 1 };
  const grant = (c: PoolClient) =>
    grantMemberPeriod(pgrest(c) as never, { gymId: IDS.gymA, memberId: IDS.memberA }, MONTH, { planId: IDS.planA });

  it('starts a subscription for a member who has none', async () => {
    const got = await asSuperuser((c) => grant(c));
    expect(got).toEqual({ ok: true, endDate: inJs(new Date().toISOString().slice(0, 10), MONTH) });
  });

  it('extends the live one on the next payment instead of adding a second', async () => {
    await asSuperuser((c) => grant(c));
    const second = await asSuperuser((c) => grant(c));
    const rows = await asSuperuser(async (c) => {
      const { rows } = await c.query(`select id from public.member_subscriptions where member_id = $1`, [IDS.memberA]);
      return rows.length;
    });
    expect(rows).toBe(1);
    expect(second.ok && second.endDate).toBe(inJs(inJs(new Date().toISOString().slice(0, 10), MONTH), MONTH));
  });

  it('recovers from losing the INSERT race by extending the row that won', async () => {
    // The member's live row is not 'active', so the first read finds nothing
    // and this writer tries to INSERT — which is exactly the state a writer is
    // in when a concurrent fulfiller has just created the row. The index says
    // no, and the fallback re-read finds it. Before the index, this second row
    // was simply created: two live rows, two mirrored memberships, and access
    // equal to whichever one happened to be read next.
    //
    // past_due rather than paused: recovering a lapsing member to 'active' on
    // payment is the intended flip. A frozen row is the case that must NOT be
    // flipped, and it has its own describe below.
    const subId = await newSub('2027-06-01', { status: 'past_due' });
    const got = await asSuperuser((c) => grant(c));
    expect(got).toEqual({ ok: true, endDate: '2027-07-01' });
    const rows = await asSuperuser(async (c) => {
      const { rows } = await c.query(`select id, status from public.member_subscriptions where member_id = $1`, [IDS.memberA]);
      return rows;
    });
    expect(rows).toEqual([{ id: subId, status: 'active' }]);
  });
});

describe('a renewal that lands on a frozen membership', () => {
  // The one-live index took away the escape hatch this path used to have. A
  // frozen member who renews (in the app, from WhatsApp, or at the front desk
  // with "extend") reaches grantMemberPeriod, which reads only status='active',
  // finds nothing, INSERTs — and is now refused, because 'paused' is live. The
  // fallback then extends the FROZEN row. That is fine as long as the row is
  // still frozen afterwards: resumeFreeze() requires status='paused' and
  // approveFreeze() requires 'pause_requested' (lib/actions/freeze.ts), so a
  // row that came back 'active' with its pause window still set can never be
  // resumed or approved, and nothing else credits the frozen days.
  beforeAll(async () => { await seed(); });
  beforeEach(async () => {
    await asSuperuser((c) => c.query(`delete from public.member_subscriptions where member_id = $1`, [IDS.memberA]));
  });

  const MONTH = { duration_days: null, duration_months: 1 };
  const grant = (c: PoolClient) =>
    grantMemberPeriod(pgrest(c) as never, { gymId: IDS.gymA, memberId: IDS.memberA }, MONTH, { planId: IDS.planA });

  it('buys the member a period without ending the freeze', async () => {
    const subId = await newSub('2027-06-01', { status: 'paused' });
    await freeze(subId, '2026-08-10', '2026-09-09');

    expect(await asSuperuser((c) => grant(c))).toEqual({ ok: true, endDate: '2027-07-01' });

    // Still one row, still frozen, window untouched — so Resume still runs and
    // still credits the days, on top of the period just paid for.
    expect(await frozenState(subId)).toEqual({
      status: 'paused', pause_start: '2026-08-10', pause_end: '2026-09-09', paused: true, end_date: '2027-07-01',
    });
  });

  it('leaves a pending freeze request pending', async () => {
    // Same shape, one step earlier: voiding the request would leave staff with
    // an approve button that answers 'No pending freeze request'.
    const subId = await newSub('2027-06-01', { status: 'pause_requested' });
    expect(await asSuperuser((c) => grant(c))).toEqual({ ok: true, endDate: '2027-07-01' });
    expect((await frozenState(subId)).status).toBe('pause_requested');
  });
});

describe('a recurring charge for a mandate whose row is no longer live', () => {
  // findSub() resolves by paystack_subscription_code and does not filter on
  // status, and onSubscriptionEnd leaves that code on the row it expires. So a
  // retried or out-of-order charge.success can hand extendMemberSub a row that
  // is NOT in the live set while the member already has one that is — and the
  // RPC's flip to 'active' then collides with the one-live index. Without the
  // recovery, onRecurringCharge deletes the payment it just wrote and fails the
  // webhook, so Paystack retries the same charge forever: the member is debited
  // and never credited.
  beforeAll(async () => { await seed(); });
  beforeEach(async () => {
    await asSuperuser((c) => c.query(`delete from public.member_subscriptions where member_id = $1`, [IDS.memberA]));
  });

  const MONTH = { duration_days: null, duration_months: 1 };

  it('surfaces the index refusal as 23505 instead of a bare message', async () => {
    const expired = await newSub('2027-01-01', { status: 'expired', code: 'SUB_x' });
    await newSub('2027-06-01'); // the live row the member picked up meanwhile
    const got = await asSuperuser((c) => extendMemberSub(pgrest(c) as never, expired, MONTH));
    expect(got.ok).toBe(false);
    expect(!got.ok && got.code).toBe('23505');
  });

  it('and the fallback credits the period to the row that IS live', async () => {
    await newSub('2027-01-01', { status: 'expired', code: 'SUB_x' });
    const live = await newSub('2027-06-01');
    // What lib/member-sub-fulfill.ts does on 23505: re-resolve by member/gym.
    const got = await asSuperuser((c) =>
      grantMemberPeriod(pgrest(c) as never, { gymId: IDS.gymA, memberId: IDS.memberA }, MONTH));
    expect(got).toEqual({ ok: true, endDate: '2027-07-01' });
    expect(await endDateOf(live)).toBe('2027-07-01');
  });

  it('is wired into the auto-debit fulfiller', () => {
    // Source lock: onRecurringCharge is webhook code behind a signature check
    // and a live Paystack payload, so what is pinned here is that the 23505 out
    // of extendMemberSub is recovered rather than turned into a failed webhook.
    const src = read('lib/member-sub-fulfill.ts');
    const extend = src.indexOf('await extendMemberSub(');
    const recover = src.indexOf("extended.code === '23505'");
    expect(recover).toBeGreaterThan(extend);
    expect(src.slice(recover)).toContain('grantMemberPeriod(');
  });
});
