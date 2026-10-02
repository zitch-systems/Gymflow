import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asSuperuser, withSession } from './db';
import { IDS, seed } from './seed';

const incidentCalls = vi.hoisted(() => [] as Array<{ message: string; extra?: Record<string, unknown> }>);

vi.mock('@/lib/server-error', () => ({
  captureServerEvent: async (message: string, extra?: Record<string, unknown>) => {
    incidentCalls.push({ message, extra });
  },
}));

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fakeAdmin() }));

// Execute the shipped RPC as the same service role used by webhooks, while
// preserving Supabase's in-band { data, error } response contract.
function fakeAdmin() {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name !== 'apply_payment_refund') return { data: null, error: { message: `unexpected RPC ${name}` } };
      try {
        const data = await withSession({ role: 'service_role', commit: true }, async (client) => {
          const { rows } = await client.query(
            `select public.apply_payment_refund($1,$2,$3,$4,$5,$6) as result`,
            [args.p_event_key, args.p_reference, args.p_event_name, args.p_amount_kobo, args.p_currency, args.p_full_dispute],
          );
          return rows[0].result;
        });
        return { data, error: null };
      } catch (error) {
        const e = error as { message?: string; code?: string };
        return { data: null, error: { message: e.message ?? 'RPC failed', code: e.code } };
      }
    },
  };
}

const { handleRefundEvent, isRefundEvent } = await import('@/lib/paystack-refund');

const MEMBER_REF = 'refund-member';
const PLATFORM_REF = 'refund-platform';

async function seedPayments() {
  await asSuperuser(async (client) => {
    const payment = await client.query(
      `insert into public.payments
         (gym_id,member_id,plan_id,amount,currency,status,payment_status,paystack_reference)
       values($1,$2,$3,100,'NGN','success','successful',$4) returning id`,
      [IDS.gymA, IDS.memberA, IDS.planA, MEMBER_REF],
    );
    const subscription = await client.query(
      `select id from public.member_subscriptions where gym_id=$1 and member_id=$2`,
      [IDS.gymA, IDS.memberA],
    );
    await client.query(
      `insert into public.payment_coverage_allocations
         (payment_id,gym_id,member_id,subscription_id,coverage_start,coverage_end,amount_kobo)
       values($1,$2,$3,$4,current_date+21,current_date+30,10000)`,
      [payment.rows[0].id, IDS.gymA, IDS.memberA, subscription.rows[0].id],
    );
    await client.query(
      `insert into public.platform_payments
         (gym_id,amount,currency,payment_status,paystack_reference,billing_period_start,billing_period_end)
       values($1,200,'NGN','successful',$2,current_date,current_date+30)`,
      [IDS.gymB, PLATFORM_REF],
    );
  });
}

function refundProcessed(reference: string, amount: string | null = '10000', id: string | null = 'RF_1') {
  return {
    event: 'refund.processed',
    data: {
      status: 'processed', transaction_reference: reference,
      ...(id === null ? {} : { refund_reference: id }),
      ...(amount === null ? {} : { amount }), currency: 'NGN',
    },
  };
}

function chargeRefund(reference: string, amount = '5000', id = 'RF_SHARED') {
  return {
    event: 'charge.refund',
    data: { reference, status: 'processed', refund_reference: id, amount, currency: 'NGN' },
  };
}

function dispute(reference: string, resolution: string, amount?: string) {
  return {
    event: 'charge.dispute.resolve',
    data: {
      status: 'resolved', resolution, transaction: { reference, currency: 'NGN' },
      ...(amount === undefined ? {} : { amount }),
    },
  };
}

async function paymentState(reference: string, table: 'payments' | 'platform_payments' = 'payments') {
  return asSuperuser(async (client) => {
    const { rows } = await client.query(
      `select payment_status::text payment_status,refunded_amount::numeric(12,2)::text refunded_amount
       from public.${table} where paystack_reference=$1`,
      [reference],
    );
    return rows[0] as { payment_status: string; refunded_amount: string };
  });
}

beforeEach(async () => {
  incidentCalls.length = 0;
  await seed();
  await seedPayments();
});

describe('Paystack refund webhook adapter', () => {
  it('claims only terminal refund routing and informational refund events', () => {
    for (const event of ['charge.refund', 'refund.processed', 'refund.pending', 'refund.failed', 'charge.dispute.resolve']) {
      expect(isRefundEvent({ event })).toBe(true);
    }
    for (const event of ['charge.success', 'charge.dispute.create', 'transfer.reversed', '']) {
      expect(isRefundEvent({ event })).toBe(false);
    }
  });

  it('accepts Paystack official refund.processed fields and applies the exact amount', async () => {
    expect(await handleRefundEvent(refundProcessed(MEMBER_REF))).toEqual({ ok: true });
    expect(await paymentState(MEMBER_REF)).toEqual({ payment_status: 'refunded', refunded_amount: '100.00' });
    const evidence = await asSuperuser((client) =>
      client.query(`select event_key,amount_kobo,currency,applied_at is not null applied from public.payment_refund_events`),
    );
    expect(evidence.rows).toEqual([{ event_key: 'refund:RF_1', amount_kobo: '10000', currency: 'NGN', applied: true }]);
  });

  it('deduplicates charge.refund and refund.processed carrying the same provider refund identity', async () => {
    expect(await handleRefundEvent(chargeRefund(MEMBER_REF))).toEqual({ ok: true });
    expect(await handleRefundEvent(refundProcessed(MEMBER_REF, '5000', 'RF_SHARED'))).toEqual({ ok: true });
    expect(await paymentState(MEMBER_REF)).toEqual({ payment_status: 'successful', refunded_amount: '50.00' });
    const count = await asSuperuser(async (client) => {
      const { rows } = await client.query(`select count(*)::int n from public.payment_refund_events`);
      return rows[0].n;
    });
    expect(count).toBe(1);
  });

  it('records refund-before-charge evidence as pending for later atomic settlement', async () => {
    expect(await handleRefundEvent(refundProcessed('refund-not-settled-yet'))).toEqual({ ok: true });
    const evidence = await asSuperuser((client) =>
      client.query(`select reference,applied_at,result from public.payment_refund_events where event_key='refund:RF_1'`),
    );
    expect(evidence.rows).toEqual([{ reference: 'refund-not-settled-yet', applied_at: null, result: null }]);
  });

  it('does not infer a full refund when amount or provider identity is missing', async () => {
    expect(await handleRefundEvent(refundProcessed(MEMBER_REF, null))).toMatchObject({ ok: false, permanent: true });
    expect(await handleRefundEvent(refundProcessed(MEMBER_REF, '10000', null))).toMatchObject({ ok: false, permanent: true });
    expect(await paymentState(MEMBER_REF)).toEqual({ payment_status: 'successful', refunded_amount: '0.00' });
    const count = await asSuperuser(async (client) => {
      const { rows } = await client.query(`select count(*)::int n from public.payment_refund_events`);
      return rows[0].n;
    });
    expect(count).toBe(0);
  });

  it('rejects missing charge reference, invalid amount, and non-NGN evidence permanently', async () => {
    expect(await handleRefundEvent({ event: 'refund.processed', data: { refund_reference: 'RF_X', amount: '100', currency: 'NGN' } }))
      .toMatchObject({ ok: false, permanent: true });
    expect(await handleRefundEvent(refundProcessed(MEMBER_REF, '-1'))).toMatchObject({ ok: false, permanent: true });
    const wrongCurrency = refundProcessed(MEMBER_REF);
    wrongCurrency.data.currency = 'USD';
    expect(await handleRefundEvent(wrongCurrency)).toMatchObject({ ok: false, permanent: true });
  });

  it('keeps pending/failed refunds and non-lost disputes informational', async () => {
    for (const event of [
      { event: 'refund.pending', data: { transaction_reference: MEMBER_REF } },
      { event: 'refund.failed', data: { transaction_reference: MEMBER_REF } },
      dispute(MEMBER_REF, 'declined'), dispute(MEMBER_REF, 'merchant-declined'), dispute(MEMBER_REF, 'pending'),
    ]) expect(await handleRefundEvent(event)).toEqual({ ok: true });
    expect(await paymentState(MEMBER_REF)).toEqual({ payment_status: 'successful', refunded_amount: '0.00' });
  });

  it('treats a lost dispute with amount as partial and without amount as full', async () => {
    expect(await handleRefundEvent(dispute(MEMBER_REF, 'merchant-accepted', '5000'))).toEqual({ ok: true });
    expect(await paymentState(MEMBER_REF)).toEqual({ payment_status: 'successful', refunded_amount: '50.00' });
    await asSuperuser(async (client) => {
      await client.query(`delete from public.payment_refund_events`);
      await client.query(`update public.payments set refunded_amount=0,payment_status='successful',status='success' where paystack_reference=$1`, [MEMBER_REF]);
      await client.query(`update public.payment_coverage_allocations set revoked_at=null,revoked_days=0 where payment_id=(select id from public.payments where paystack_reference=$1)`, [MEMBER_REF]);
    });
    expect(await handleRefundEvent(dispute(MEMBER_REF, 'merchant-accepted'))).toEqual({ ok: true });
    expect(await paymentState(MEMBER_REF)).toEqual({ payment_status: 'refunded', refunded_amount: '100.00' });
  });

  it('records a platform partial refund without revoking access', async () => {
    expect(await handleRefundEvent(refundProcessed(PLATFORM_REF, '10000'))).toEqual({ ok: true });
    expect(await paymentState(PLATFORM_REF, 'platform_payments')).toEqual({ payment_status: 'successful', refunded_amount: '100.00' });
    expect(incidentCalls).toHaveLength(0);
  });

  it('durably refunds legacy unallocated platform money and sends entitlement review', async () => {
    expect(await handleRefundEvent(refundProcessed(PLATFORM_REF, '20000'))).toMatchObject({ ok: false, permanent: true });
    expect(await paymentState(PLATFORM_REF, 'platform_payments')).toEqual({ payment_status: 'refunded', refunded_amount: '200.00' });
    expect(incidentCalls).toHaveLength(1);
    expect(incidentCalls[0]).toMatchObject({
      message: 'refund entitlement allocation requires review',
      extra: { reference: PLATFORM_REF, event: 'refund.processed' },
    });
  });
});
