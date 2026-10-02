import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { asSuperuser, withSession } from './db';
import { IDS, reset, seed } from './seed';

type Charge = {
  reference: string;
  paidAt: string;
  subscription?: string;
};

async function settle(input: Charge) {
  return withSession({ role: 'service_role', commit: true }, async (c) => {
    await c.query(`select set_config('request.jwt.claims','{"role":"service_role"}',true)`);
    const { rows } = await c.query<{ result: Record<string, unknown> }>(
      `select public.settle_platform_charge($1,$2,$3,$4,$5,$6,$7,$8,$9) as result`,
      [
        input.reference, IDS.gymA, 1_399_900, 'NGN', 'starter', 'monthly', input.paidAt,
        'CUS_atomic', input.subscription ?? 'SUB_atomic',
      ],
    );
    return rows[0].result;
  });
}

async function state(reference?: string) {
  return asSuperuser(async (c) => {
    const { rows: gym } = await c.query(
      `select subscription_current_period_end, subscription_plan, subscription_status
         from public.gyms where id=$1`,
      [IDS.gymA],
    );
    const { rows: payments } = await c.query(
      `select p.id,p.paystack_reference,c.coverage_start,c.coverage_end,c.original_start,c.original_end
         from public.platform_payments p
         left join public.platform_payment_coverage c on c.payment_id=p.id
        where p.gym_id=$1 and ($2::text is null or p.paystack_reference=$2)
        order by p.created_at`,
      [IDS.gymA, reference ?? null],
    );
    return { gym: gym[0], payments };
  });
}

describe('atomic platform charge fulfillment', () => {
  beforeEach(async () => {
    await seed();
    await asSuperuser((c) => c.query(
      `update public.gyms set subscription_current_period_end=null,
        paystack_subscription_code='SUB_previous',subscription_plan='starter',
        subscription_billing_cycle='monthly',subscription_status='trial' where id=$1`,
      [IDS.gymA],
    ));
  });
  afterAll(reset);

  it('serializes parallel callback/webhook delivery to one ledger and entitlement change', async () => {
    const charge = { reference: 'ATOMIC-parallel', paidAt: '2026-09-01T10:00:00.000Z' };
    const results = await Promise.all([settle(charge), settle(charge)]);

    expect(results.map((result) => result.created).sort()).toEqual([false, true]);
    const got = await state(charge.reference);
    expect(got.payments).toHaveLength(1);
    expect(got.payments[0].coverage_start.toISOString()).toBe(charge.paidAt);
    expect(got.gym.subscription_plan).toBe('starter');
    expect(got.gym.subscription_status).toBe('active');
    expect(got.gym.subscription_current_period_end.toISOString()).toBe('2026-10-01T10:00:00.000Z');
  });

  it('rolls the ledger and entitlement back when an in-transaction audit write fails', async () => {
    await asSuperuser(async (c) => {
      await c.query(`create or replace function private.fail_platform_charge_audit()
        returns trigger language plpgsql as $$ begin
          if new.action='platform_charge_committed' then raise exception 'forced audit failure'; end if;
          return new;
        end $$`);
      await c.query(`create trigger test_fail_platform_charge_audit before insert on public.audit_logs
        for each row execute function private.fail_platform_charge_audit()`);
    });
    try {
      await expect(settle({ reference: 'ATOMIC-rollback', paidAt: '2026-09-01T10:00:00.000Z' }))
        .rejects.toThrow(/forced audit failure/);
      const got = await state('ATOMIC-rollback');
      expect(got.payments).toHaveLength(0);
      expect(got.gym.subscription_status).toBe('trial');
      expect(got.gym.subscription_current_period_end).toBeNull();
    } finally {
      await asSuperuser(async (c) => {
        await c.query(`drop trigger if exists test_fail_platform_charge_audit on public.audit_logs`);
        await c.query(`drop function if exists private.fail_platform_charge_audit()`);
      });
    }
  });

  it('preserves the provider paid_at and never lets a recovered older charge shorten later access', async () => {
    await settle({ reference: 'ATOMIC-newer', paidAt: '2026-09-01T10:00:00.000Z' });
    await settle({ reference: 'ATOMIC-older', paidAt: '2026-08-01T10:00:00.000Z' });

    const older = await state('ATOMIC-older');
    expect(older.payments[0].original_start.toISOString()).toBe('2026-08-01T10:00:00.000Z');
    expect(older.payments[0].original_end.toISOString()).toBe('2026-09-01T10:00:00.000Z');
    expect(older.payments[0].coverage_start.toISOString()).toBe('2026-10-01T10:00:00.000Z');
    expect(older.gym.subscription_current_period_end.toISOString()).toBe('2026-11-01T10:00:00.000Z');
  });

  it('applies refund-before-charge evidence in the same transaction and grants no paid future', async () => {
    const paidAt = new Date(Date.now() - 1_000).toISOString();
    await asSuperuser((c) => c.query(
      `insert into public.payment_refund_events
        (event_key,reference,event_name,amount_kobo,currency,is_full_dispute)
       values($1,$2,'refund.processed',$3,'NGN',false)`,
      ['refund-before-atomic', 'ATOMIC-refunded-first', 1_399_900],
    ));

    const result = await settle({ reference: 'ATOMIC-refunded-first', paidAt });
    expect(result.fully_refunded).toBe(true);
    const got = await asSuperuser(async (c) => (await c.query(
      `select p.payment_status,c.revoked_at,c.revoked_seconds,g.subscription_current_period_end
         from public.platform_payments p
         join public.platform_payment_coverage c on c.payment_id=p.id
         join public.gyms g on g.id=p.gym_id where p.paystack_reference=$1`,
      ['ATOMIC-refunded-first'],
    )).rows[0]);
    expect(got.payment_status).toBe('refunded');
    expect(got.revoked_at).not.toBeNull();
    expect(Number(got.revoked_seconds)).toBeGreaterThan(0);
    expect(new Date(got.subscription_current_period_end).getTime()).toBeLessThanOrEqual(Date.now() + 2_000);
  });
});
