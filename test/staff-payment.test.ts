import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { asSuperuser, fixtureSessionId, withSession } from './db';
import { IDS, seed } from './seed';

const MANAGER = 'a3333333-3333-4333-8333-333333333333';
const PLAN_PRICE_KOBO = 1_000_000;

type PaymentArgs = {
  operationId: string;
  gymId?: string;
  memberId?: string;
  receipt?: string;
  amountKobo?: number | null;
  method?: string;
  planId?: string | null;
  extend?: boolean;
  reason?: string;
};

const operationId = (suffix: number) =>
  `d1111111-1111-4111-8111-${String(suffix).padStart(12, '0')}`;

async function recordPayment(client: PoolClient, args: PaymentArgs) {
  const { rows } = await client.query(
    `select public.record_staff_payment(
       $1::uuid,$2::uuid,$3::uuid,$4::text,$5::bigint,$6::text,$7::uuid,$8::boolean,$9::text
     ) as result`,
    [
      args.operationId,
      args.gymId ?? IDS.gymA,
      args.memberId ?? IDS.memberA,
      args.receipt ?? `receipt-${args.operationId}`,
      args.amountKobo === undefined ? PLAN_PRICE_KOBO : args.amountKobo,
      args.method ?? 'cash',
      args.planId === undefined ? IDS.planA : args.planId,
      args.extend ?? true,
      args.reason ?? 'Cash received at the front desk',
    ],
  );
  return rows[0].result as { created: boolean; payment_id: string; end_date: string | null; amount_kobo: number };
}

async function committedPayment(uid: string, args: PaymentArgs) {
  return withSession({ role: 'authenticated', uid, commit: true }, (client) => recordPayment(client, args));
}

async function expectPgError(work: Promise<unknown>, code: string, message?: RegExp) {
  try {
    await work;
    throw new Error('Expected PostgreSQL to reject the operation');
  } catch (error) {
    const pgError = error as { code?: string; message?: string };
    expect(pgError.code).toBe(code);
    if (message) expect(pgError.message).toMatch(message);
  }
}

async function financialState() {
  return asSuperuser(async (client) => {
    const { rows } = await client.query(
      `select
         (select count(*)::int from public.payments where paystack_reference like 'MANUAL-%') as payments,
         (select count(*)::int from public.payment_coverage_allocations) as allocations,
         (select count(*)::int from public.staff_financial_operations) as operations,
         (select count(*)::int from public.audit_logs where action='staff_payment_committed') as audits,
         (select to_char(end_date,'YYYY-MM-DD') from public.member_subscriptions
           where gym_id=$1 and member_id=$2 order by end_date desc limit 1) as end_date,
         (select status::text from public.member_subscriptions
           where gym_id=$1 and member_id=$2 order by end_date desc limit 1) as status`,
      [IDS.gymA, IDS.memberA],
    );
    return rows[0] as {
      payments: number;
      allocations: number;
      operations: number;
      audits: number;
      end_date: string;
      status: string;
    };
  });
}

async function useVerifiedSession(client: PoolClient, uid: string, salt: string) {
  const sessionId = fixtureSessionId(uid, salt);
  await client.query(
    `insert into auth.sessions(id,user_id,not_after)
     values($1,$2,now()+interval '1 day')
     on conflict(id) do update set user_id=excluded.user_id,not_after=excluded.not_after`,
    [sessionId, uid],
  );
  await client.query(
    `insert into private.privileged_session_verifications(session_id,user_id,expires_at,method)
     values($1,$2,now()+interval '18 hours','email_code')
     on conflict(session_id) do update set user_id=excluded.user_id,expires_at=excluded.expires_at`,
    [sessionId, uid],
  );
  await client.query(`select set_config('request.jwt.claim.sub',$1,true)`, [uid]);
  await client.query(`select set_config('request.jwt.claim.role','authenticated',true)`);
  await client.query(`select set_config('request.jwt.claims',$1,true)`, [
    JSON.stringify({ sub: uid, role: 'authenticated', session_id: sessionId }),
  ]);
  await client.query('set local role authenticated');
}

type FailureStage = 'entitlement' | 'payment' | 'audit';

async function paymentWithInjectedFailure(stage: FailureStage, suffix: number) {
  const target = {
    entitlement: { event: 'update', table: 'member_subscriptions', when: '' },
    payment: { event: 'insert', table: 'payments', when: '' },
    audit: { event: 'insert', table: 'audit_logs', when: `when (new.action='staff_payment_committed')` },
  }[stage];

  return asSuperuser(async (client) => {
    await client.query('begin');
    try {
      await client.query(
        `create function pg_temp.reject_staff_payment_test() returns trigger language plpgsql as $$
         begin raise exception 'injected ${stage} failure'; end $$`,
      );
      await client.query(
        `create trigger reject_staff_payment_test before ${target.event} on public.${target.table}
         for each row ${target.when} execute function pg_temp.reject_staff_payment_test()`,
      );
      await useVerifiedSession(client, IDS.ownerA, `failure-${stage}`);
      try {
        await recordPayment(client, {
          operationId: operationId(suffix),
          receipt: `failure-${stage}`,
        });
        throw new Error('Expected injected trigger to abort the RPC');
      } catch (error) {
        return error as { message?: string };
      }
    } finally {
      await client.query('rollback');
    }
  });
}

beforeEach(async () => {
  await seed();
  await asSuperuser(async (client) => {
    await client.query(`insert into auth.users(id,email) values($1,'managerA@example.com')`, [MANAGER]);
    await client.query(`update public.profiles set gym_id=$2,role='manager' where id=$1`, [MANAGER, IDS.gymA]);
    await client.query(
      `insert into public.gym_staff_links(gym_id,user_id,role,is_active)
       values($1,$2,'manager',true)`,
      [IDS.gymA, MANAGER],
    );
  });
});

// audit_logs intentionally retains financial evidence and references auth.users.
// Remove only this suite's records before seed() attempts to rebuild auth fixtures.
afterEach(async () => {
  await asSuperuser((client) =>
    client.query(
      `delete from public.audit_logs
       where action='staff_payment_committed'
          or (action='insert.payment' and (
            new_values->>'paystack_reference' like 'MANUAL-%'
            or new_values->>'paystack_reference' like 'callback-vs-staff%'
          ))`,
    ),
  );
});

describe('record_staff_payment authorization and immutable authority', () => {
  it('allows verified staff and denies password-only, non-staff, and other-gym identities', async () => {
    const created = await committedPayment(IDS.ownerA, {
      operationId: operationId(1),
      receipt: 'verified-owner',
      extend: false,
      planId: null,
      amountKobo: 25_000,
    });
    expect(created.created).toBe(true);

    await expectPgError(
      withSession({ role: 'authenticated', uid: IDS.ownerA, verified: false }, (client) =>
        recordPayment(client, { operationId: operationId(2), receipt: 'password-only' }),
      ),
      '42501',
      /Verified gym staff required/,
    );
    await expectPgError(
      withSession({ role: 'authenticated', uid: IDS.ownerB }, (client) =>
        recordPayment(client, { operationId: operationId(3), receipt: 'other-gym' }),
      ),
      '42501',
    );
    await expectPgError(
      withSession({ role: 'authenticated', uid: IDS.memberA }, (client) =>
        recordPayment(client, { operationId: operationId(4), receipt: 'ordinary-member' }),
      ),
      '42501',
    );
  });

  it('requires the RPC for raw payment creation', async () => {
    await expectPgError(
      withSession({ role: 'authenticated', uid: IDS.ownerA }, (client) =>
        client.query(
          `insert into public.payments(gym_id,member_id,amount,currency,status,payment_status,paystack_reference)
           values($1,$2,100,'NGN','success','successful','raw-staff-payment')`,
          [IDS.gymA, IDS.memberA],
        ),
      ),
      '42501',
    );
  });

  it('rejects a direct paid-through date grant without the receipt-scoped RPC context', async () => {
    const before = await financialState();
    await expectPgError(
      withSession({ role: 'authenticated', uid: IDS.ownerA }, (client) =>
        client.query(
          `update public.member_subscriptions set end_date=end_date+1
           where gym_id=$1 and member_id=$2`,
          [IDS.gymA, IDS.memberA],
        ),
      ),
      '42501',
      /Record the payment with a receipt to grant membership dates/,
    );
    expect(await financialState()).toEqual(before);
  });

  it('does not allow authenticated clients to update or delete operation records', async () => {
    await committedPayment(IDS.ownerA, {
      operationId: operationId(5),
      receipt: 'immutable-operation',
      extend: false,
      planId: null,
      amountKobo: 50_000,
    });

    await expectPgError(
      withSession({ role: 'authenticated', uid: IDS.ownerA }, (client) =>
        client.query(`update public.staff_financial_operations set reason='tampered' where operation_id=$1`, [operationId(5)]),
      ),
      '42501',
    );
    await expectPgError(
      withSession({ role: 'authenticated', uid: IDS.ownerA }, (client) =>
        client.query(`delete from public.staff_financial_operations where operation_id=$1`, [operationId(5)]),
      ),
      '42501',
    );

    const row = await asSuperuser((client) =>
      client.query(`select reason from public.staff_financial_operations where operation_id=$1`, [operationId(5)]),
    );
    expect(row.rows).toEqual([{ reason: 'Cash received at the front desk' }]);
  });
});

describe('record_staff_payment transaction atomicity', () => {
  for (const [stage, suffix] of [
    ['entitlement', 10],
    ['payment', 11],
    ['audit', 12],
  ] as const) {
    it(`rolls back every financial and membership write when ${stage} persistence fails`, async () => {
      const before = await financialState();
      const error = await paymentWithInjectedFailure(stage, suffix);
      expect(error.message).toContain(`injected ${stage} failure`);
      expect(await financialState()).toEqual(before);
    });
  }
});

describe('record_staff_payment idempotency and concurrency', () => {
  it('commits one payment, allocation, audit, and term for simultaneous same-operation retries by two staff', async () => {
    const before = await financialState();
    const args = { operationId: operationId(20), receipt: 'same-operation-race' };
    const results = await Promise.all([
      committedPayment(IDS.ownerA, args),
      committedPayment(MANAGER, args),
    ]);

    expect(results.map((result) => result.created).sort()).toEqual([false, true]);
    expect(new Set(results.map((result) => result.payment_id)).size).toBe(1);
    const after = await financialState();
    expect(after.payments - before.payments).toBe(1);
    expect(after.allocations - before.allocations).toBe(1);
    expect(after.operations - before.operations).toBe(1);
    expect(after.audits - before.audits).toBe(1);
    expect(after.end_date).not.toBe(before.end_date);
  });

  it('deduplicates simultaneous distinct operation IDs that share a receipt', async () => {
    const results = await Promise.all([
      committedPayment(IDS.ownerA, { operationId: operationId(21), receipt: 'same-receipt-race' }),
      committedPayment(MANAGER, { operationId: operationId(22), receipt: 'same-receipt-race' }),
    ]);

    expect(results.map((result) => result.created).sort()).toEqual([false, true]);
    expect(new Set(results.map((result) => result.payment_id)).size).toBe(1);
    const state = await financialState();
    expect(state).toMatchObject({ payments: 1, allocations: 1, operations: 1, audits: 1 });
  });

  it('rejects reuse of a receipt for a different member or amount', async () => {
    await committedPayment(IDS.ownerA, {
      operationId: operationId(23),
      receipt: 'conflicting-receipt',
      extend: false,
      planId: null,
      amountKobo: 50_000,
    });

    await expectPgError(
      withSession({ role: 'authenticated', uid: IDS.ownerA }, (client) =>
        recordPayment(client, {
          operationId: operationId(24),
          receipt: 'conflicting-receipt',
          extend: false,
          planId: null,
          amountKobo: 50_001,
        }),
      ),
      '22023',
      /already used for a different payment/,
    );
    await expectPgError(
      withSession({ role: 'authenticated', uid: IDS.ownerA }, (client) =>
        recordPayment(client, {
          operationId: operationId(25),
          receipt: 'conflicting-receipt',
          memberId: IDS.memberB,
          extend: false,
          planId: null,
          amountKobo: 50_000,
        }),
      ),
      '22023',
      /already used for a different payment/,
    );
    expect((await financialState()).operations).toBe(1);
  });

  it('serializes distinct renewals into adjacent calendar terms, including month-end clamping', async () => {
    const expected = await asSuperuser(async (client) => {
      const { rows } = await client.query(
        `with dates as (
           select make_date(extract(year from current_date)::int + 1,1,30) as old_end
         ), terms as (
           select old_end, old_end+1 as first_start,
             private.coverage_end(old_end+1,0,1) as first_end from dates
         )
         select to_char(old_end,'YYYY-MM-DD') old_end,
           to_char(first_start,'YYYY-MM-DD') first_start,
           to_char(first_end,'YYYY-MM-DD') first_end,
           to_char(first_end+1,'YYYY-MM-DD') second_start,
           to_char(private.coverage_end(first_end+1,0,1),'YYYY-MM-DD') second_end
         from terms`,
      );
      await client.query(
        `update public.member_subscriptions set end_date=$3,status='active'
         where gym_id=$1 and member_id=$2`,
        [IDS.gymA, IDS.memberA, rows[0].old_end],
      );
      return rows[0] as Record<'old_end' | 'first_start' | 'first_end' | 'second_start' | 'second_end', string>;
    });

    const results = await Promise.all([
      committedPayment(IDS.ownerA, { operationId: operationId(26), receipt: 'renewal-one' }),
      committedPayment(MANAGER, { operationId: operationId(27), receipt: 'renewal-two' }),
    ]);
    expect(results.every((result) => result.created)).toBe(true);

    const rows = await asSuperuser((client) =>
      client.query(
        `select to_char(coverage_start,'YYYY-MM-DD') coverage_start,
           to_char(coverage_end,'YYYY-MM-DD') coverage_end
         from public.payment_coverage_allocations order by coverage_start`,
      ),
    );
    expect(rows.rows).toEqual([
      { coverage_start: expected.first_start, coverage_end: expected.first_end },
      { coverage_start: expected.second_start, coverage_end: expected.second_end },
    ]);
    expect((await financialState()).end_date).toBe(expected.second_end);
  });

  it('serializes a Paystack callback and staff cash as two distinct paid terms', async () => {
    const expected = await asSuperuser(async (client) => {
      const { rows } = await client.query(
        `with dates as (
           select make_date(extract(year from current_date)::int + 1,1,30) as old_end
         ), terms as (
           select old_end,old_end+1 first_start,private.coverage_end(old_end+1,0,1) first_end from dates
         )
         select to_char(old_end,'YYYY-MM-DD') old_end,
           to_char(first_start,'YYYY-MM-DD') first_start,
           to_char(first_end,'YYYY-MM-DD') first_end,
           to_char(first_end+1,'YYYY-MM-DD') second_start,
           to_char(private.coverage_end(first_end+1,0,1),'YYYY-MM-DD') second_end
         from terms`,
      );
      await client.query(
        `update public.member_subscriptions set end_date=$3,status='active'
         where gym_id=$1 and member_id=$2`,
        [IDS.gymA, IDS.memberA, rows[0].old_end],
      );
      await client.query(
        `insert into public.member_payment_checkouts
           (reference,gym_id,member_id,plan_id,amount_kobo,duration_days,duration_months)
         values('callback-vs-staff',$1,$2,$3,$4,0,1)`,
        [IDS.gymA, IDS.memberA, IDS.planA, PLAN_PRICE_KOBO],
      );
      return rows[0] as Record<'first_start' | 'first_end' | 'second_start' | 'second_end', string>;
    });

    const [cash, callback] = await Promise.all([
      committedPayment(IDS.ownerA, {
        operationId: operationId(28),
        receipt: 'callback-vs-staff-cash',
      }),
      withSession({ role: 'service_role', commit: true }, async (client) => {
        const { rows } = await client.query(
          `select public.settle_member_charge(
             'callback-vs-staff',$1,$2,$3,$4,'NGN',0,1,false,'card','{}'::jsonb,null
           ) as result`,
          [IDS.gymA, IDS.memberA, IDS.planA, PLAN_PRICE_KOBO],
        );
        return rows[0].result as { created: boolean; payment_id: string; end_date: string };
      }),
    ]);

    expect(cash.created).toBe(true);
    expect(callback.created).toBe(true);
    expect(cash.payment_id).not.toBe(callback.payment_id);
    const rows = await asSuperuser((client) =>
      client.query(
        `select p.paystack_reference,
           to_char(a.coverage_start,'YYYY-MM-DD') coverage_start,
           to_char(a.coverage_end,'YYYY-MM-DD') coverage_end
         from public.payment_coverage_allocations a join public.payments p on p.id=a.payment_id
         order by a.coverage_start`,
      ),
    );
    expect(rows.rows.map((row) => ({ coverage_start: row.coverage_start, coverage_end: row.coverage_end }))).toEqual([
      { coverage_start: expected.first_start, coverage_end: expected.first_end },
      { coverage_start: expected.second_start, coverage_end: expected.second_end },
    ]);
    expect(new Set(rows.rows.map((row) => row.paystack_reference))).toEqual(
      new Set(['callback-vs-staff', `MANUAL-${operationId(28)}`]),
    );
    expect((await financialState()).end_date).toBe(expected.second_end);
  });
});

describe('record_staff_payment fulfillment validation', () => {
  async function expectNoMoneylessRenewal(work: () => Promise<unknown>, code: string) {
    const before = await financialState();
    await expectPgError(work(), code);
    expect(await financialState()).toEqual(before);
  }

  it('rejects a renewal amount that does not exactly match the selected plan', async () => {
    await expectNoMoneylessRenewal(
      () => withSession({ role: 'authenticated', uid: IDS.ownerA }, (client) =>
        recordPayment(client, {
          operationId: operationId(30),
          receipt: 'wrong-price',
          amountKobo: PLAN_PRICE_KOBO - 1,
        }),
      ),
      '22023',
    );
  });

  it('rejects renewal for an inactive member link', async () => {
    await asSuperuser((client) =>
      client.query(`update public.gym_member_links set is_active=false where gym_id=$1 and user_id=$2`, [IDS.gymA, IDS.memberA]),
    );
    await expectNoMoneylessRenewal(
      () => withSession({ role: 'authenticated', uid: IDS.ownerA }, (client) =>
        recordPayment(client, { operationId: operationId(31), receipt: 'inactive-member' }),
      ),
      '42501',
    );
  });

  it('rejects a plan from another gym and a plan with no valid duration', async () => {
    await expectNoMoneylessRenewal(
      () => withSession({ role: 'authenticated', uid: IDS.ownerA }, (client) =>
        recordPayment(client, {
          operationId: operationId(32),
          receipt: 'cross-gym-plan',
          planId: IDS.planB,
        }),
      ),
      '22023',
    );

    await asSuperuser((client) =>
      client.query(`update public.membership_plans set duration_days=null,duration_months=0 where id=$1`, [IDS.planA]),
    );
    await expectNoMoneylessRenewal(
      () => withSession({ role: 'authenticated', uid: IDS.ownerA }, (client) =>
        recordPayment(client, { operationId: operationId(33), receipt: 'invalid-duration' }),
      ),
      '22023',
    );
  });

  it('preserves a paused subscription while extending its paid-through date', async () => {
    await asSuperuser((client) =>
      client.query(
        `update public.member_subscriptions set status='paused',end_date=current_date+30
         where gym_id=$1 and member_id=$2`,
        [IDS.gymA, IDS.memberA],
      ),
    );
    const before = await financialState();
    const result = await committedPayment(IDS.ownerA, {
      operationId: operationId(34),
      receipt: 'paused-renewal',
    });
    const after = await financialState();

    expect(result.created).toBe(true);
    expect(after.status).toBe('paused');
    expect(after.end_date).not.toBe(before.end_date);
    expect(after).toMatchObject({ payments: 1, allocations: 1, operations: 1, audits: 1 });
  });
});
