import { beforeEach, describe, expect, it } from 'vitest';
import { asSuperuser, withSession } from './db';
import { IDS, seed } from './seed';

const AMOUNT_KOBO = 1_000_000;

async function setMemberTerm(endSql = 'current_date-1', status = 'active') {
  await asSuperuser((client) =>
    client.query(
      `update public.member_subscriptions set end_date=${endSql},status=$3
       where gym_id=$1 and member_id=$2`,
      [IDS.gymA, IDS.memberA, status],
    ),
  );
}

async function reserve(reference: string, days = 10, amountKobo = AMOUNT_KOBO) {
  await asSuperuser((client) =>
    client.query(
      `insert into public.member_payment_checkouts
         (reference,gym_id,member_id,plan_id,amount_kobo,duration_days,duration_months)
       values($1,$2,$3,$4,$5,$6,0)`,
      [reference, IDS.gymA, IDS.memberA, IDS.planA, amountKobo, days],
    ),
  );
}

async function settle(reference: string, days = 10, amountKobo = AMOUNT_KOBO) {
  await reserve(reference, days, amountKobo);
  return withSession({ role: 'service_role', commit: true }, async (client) => {
    const { rows } = await client.query(
      `select public.settle_member_charge(
         $1,$2,$3,$4,$5,'NGN',$6,0,false,'card','{}'::jsonb,null
       ) as result`,
      [reference, IDS.gymA, IDS.memberA, IDS.planA, amountKobo, days],
    );
    return rows[0].result as { created: boolean; payment_id: string; end_date: string; refunded: boolean };
  });
}

async function refund(
  eventKey: string,
  reference: string,
  amountKobo: number | null,
  fullDispute = false,
) {
  return withSession({ role: 'service_role', commit: true }, async (client) => {
    const { rows } = await client.query(
      `select public.apply_payment_refund($1,$2,'refund.processed',$3,'NGN',$4) as result`,
      [eventKey, reference, amountKobo, fullDispute],
    );
    return rows[0].result as {
      pending: boolean;
      full?: boolean;
      refunded_amount_kobo?: number;
      revoked_days?: number;
      requires_review: boolean;
      replayed?: boolean;
    };
  });
}

async function memberState(reference: string) {
  return asSuperuser(async (client) => {
    const { rows } = await client.query(
      `select p.payment_status,p.status,p.refunded_amount::numeric(12,2)::text,
         to_char(a.coverage_start,'YYYY-MM-DD') coverage_start,
         to_char(a.coverage_end,'YYYY-MM-DD') coverage_end,
         a.revoked_at is not null revoked,a.revoked_days,
         to_char(s.end_date,'YYYY-MM-DD') subscription_end,s.status::text subscription_status
       from public.payments p
       left join public.payment_coverage_allocations a on a.payment_id=p.id
       left join public.member_subscriptions s on s.id=a.subscription_id
       where p.paystack_reference=$1`,
      [reference],
    );
    return rows[0] as {
      payment_status: string;
      status: string;
      refunded_amount: string;
      coverage_start: string;
      coverage_end: string;
      revoked: boolean;
      revoked_days: number;
      subscription_end: string;
      subscription_status: string;
    };
  });
}

beforeEach(seed);

describe('payment refund allocation accounting', () => {
  it('is callable only by the service role', async () => {
    await expect(
      withSession({ role: 'authenticated', uid: IDS.ownerA }, (client) =>
        client.query(
          `select public.apply_payment_refund('forbidden','missing','refund.processed',100,'NGN',false)`,
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('fully refunds a single current purchase and removes all of its unused days', async () => {
    await setMemberTerm();
    await settle('full-single', 10);
    const purchased = await memberState('full-single');
    const result = await refund('refund:full-single', 'full-single', AMOUNT_KOBO);
    const after = await memberState('full-single');

    expect(result).toMatchObject({ pending: false, full: true, refunded_amount_kobo: AMOUNT_KOBO, revoked_days: 10 });
    expect(after).toMatchObject({
      payment_status: 'refunded', status: 'refunded', refunded_amount: '10000.00',
      revoked: true, revoked_days: 10, subscription_status: 'active',
    });
    expect(after.coverage_start).toBe(purchased.coverage_start);
    expect(after.coverage_end).toBe(purchased.coverage_end);
    const yesterday = await asSuperuser(async (client) => {
      const { rows } = await client.query(`select to_char(current_date-1,'YYYY-MM-DD') as calendar_day`);
      return rows[0].calendar_day as string;
    });
    expect(after.subscription_end).toBe(yesterday);
  });

  it('shifts later valid purchases into the gap without losing any purchased days', async () => {
    await setMemberTerm();
    await settle('refunded-first', 10);
    await settle('valid-later', 7);
    const beforeFirst = await memberState('refunded-first');
    const beforeLater = await memberState('valid-later');

    await refund('refund:first', 'refunded-first', AMOUNT_KOBO);
    const afterFirst = await memberState('refunded-first');
    const afterLater = await memberState('valid-later');

    expect(afterFirst).toMatchObject({ revoked: true, revoked_days: 10 });
    expect(afterFirst.coverage_start).toBe(beforeFirst.coverage_start);
    expect(afterFirst.coverage_end).toBe(beforeFirst.coverage_end);
    expect(Date.parse(afterLater.coverage_end) - Date.parse(afterLater.coverage_start)).toBe(
      Date.parse(beforeLater.coverage_end) - Date.parse(beforeLater.coverage_start),
    );
    expect(Date.parse(beforeLater.coverage_start) - Date.parse(afterLater.coverage_start)).toBe(10 * 86_400_000);
    expect(afterLater.subscription_end).toBe(afterLater.coverage_end);
  });

  it('records an exact partial refund while retaining successful status and paid access', async () => {
    await setMemberTerm();
    await settle('partial-member', 10);
    const before = await memberState('partial-member');
    const result = await refund('refund:partial-member', 'partial-member', 250_000);
    const after = await memberState('partial-member');

    expect(result).toMatchObject({ full: false, refunded_amount_kobo: 250_000, revoked_days: 0 });
    expect(after).toMatchObject({
      payment_status: 'successful', status: 'success', refunded_amount: '2500.00', revoked: false, revoked_days: 0,
    });
    expect(after.coverage_start).toBe(before.coverage_start);
    expect(after.coverage_end).toBe(before.coverage_end);
    expect(after.subscription_end).toBe(before.subscription_end);
  });

  it('deduplicates a provider refund identity without adding its amount twice', async () => {
    await setMemberTerm();
    await settle('duplicate-refund', 10);
    const first = await refund('refund:duplicate', 'duplicate-refund', 250_000);
    const replay = await refund('refund:duplicate', 'duplicate-refund', 250_000);
    expect(first).toMatchObject({ refunded_amount_kobo: 250_000 });
    expect(replay).toMatchObject({ refunded_amount_kobo: 250_000, replayed: true });
    expect((await memberState('duplicate-refund')).refunded_amount).toBe('2500.00');
  });

  it('applies a full refund received before charge settlement in the same settlement transaction', async () => {
    await setMemberTerm();
    expect(await refund('refund:before-charge', 'before-charge', AMOUNT_KOBO)).toEqual({
      pending: true, requires_review: false, reference: 'before-charge',
    });
    const settled = await settle('before-charge', 10);
    expect(settled).toMatchObject({ created: true, refunded: true });
    const after = await memberState('before-charge');
    expect(after).toMatchObject({ payment_status: 'refunded', revoked: true, revoked_days: 10 });
    const event = await asSuperuser((client) =>
      client.query(`select applied_at is not null applied from public.payment_refund_events where event_key='refund:before-charge'`),
    );
    expect(event.rows).toEqual([{ applied: true }]);
  });

  it('preserves paused subscription status while removing refunded unused days', async () => {
    await setMemberTerm('current_date-1', 'paused');
    await settle('paused-refund', 10);
    expect((await memberState('paused-refund')).subscription_status).toBe('paused');
    await refund('refund:paused', 'paused-refund', AMOUNT_KOBO);
    expect((await memberState('paused-refund')).subscription_status).toBe('paused');
  });

  it('marks a full legacy unallocated member refund for durable entitlement review', async () => {
    await asSuperuser((client) =>
      client.query(
        `insert into public.payments(gym_id,member_id,amount,currency,status,payment_status,paystack_reference)
         values($1,$2,100,'NGN','success','successful','legacy-member')`,
        [IDS.gymA, IDS.memberA],
      ),
    );
    expect(await refund('refund:legacy-member', 'legacy-member', 10_000)).toMatchObject({
      full: true, requires_review: true,
    });
    const state = await asSuperuser((client) =>
      client.query(`select payment_status,refunded_amount::numeric(12,2)::text from public.payments where paystack_reference='legacy-member'`),
    );
    expect(state.rows).toEqual([{ payment_status: 'refunded', refunded_amount: '100.00' }]);
  });

  it('handles legacy platform partial money exactly and flags a full refund for access review', async () => {
    await asSuperuser(async (client) => {
      for (const reference of ['legacy-platform-partial', 'legacy-platform-full']) {
        await client.query(
          `insert into public.platform_payments
             (gym_id,amount,currency,payment_status,paystack_reference,billing_period_start,billing_period_end)
           values($1,200,'NGN','successful',$2,current_date,current_date+30)`,
          [IDS.gymA, reference],
        );
      }
    });
    expect(await refund('refund:platform-partial', 'legacy-platform-partial', 10_000)).toMatchObject({
      full: false, refunded_amount_kobo: 10_000, requires_review: false,
    });
    expect(await refund('refund:platform-full', 'legacy-platform-full', 20_000)).toMatchObject({
      full: true, refunded_amount_kobo: 20_000, requires_review: true,
    });
    const states = await asSuperuser((client) =>
      client.query(
        `select paystack_reference,payment_status::text,refunded_amount::numeric(12,2)::text
         from public.platform_payments where paystack_reference like 'legacy-platform-%' order by paystack_reference`,
      ),
    );
    expect(states.rows).toEqual([
      { paystack_reference: 'legacy-platform-full', payment_status: 'refunded', refunded_amount: '200.00' },
      { paystack_reference: 'legacy-platform-partial', payment_status: 'successful', refunded_amount: '100.00' },
    ]);
  });
});
