import { beforeEach, describe, expect, it } from 'vitest';
import { asSuperuser, withSession } from './db';
import { IDS, seed } from './seed';

const REF = 'atomic-member-charge';
const PERIOD = 7;

async function reserve(reference: string, amountKobo = 1_000_000) {
  await asSuperuser((c) => c.query(`insert into public.member_payment_checkouts
    (reference, gym_id, member_id, plan_id, amount_kobo, duration_days, duration_months)
    values ($1,$2,$3,$4,$5,7,0)`, [reference, IDS.gymA, IDS.memberA, IDS.planA, amountKobo]));
}

async function settle(reference: string, overrides: { amount?: number; currency?: string; gym?: string; member?: string; commission?: unknown; method?: string } = {}) {
  return withSession({ role: 'service_role', commit: true }, async (c) => {
    const { rows } = await c.query<{ result: { created: boolean; payment_id: string; end_date: string } }>(
      `select public.settle_member_charge($1,$2,$3,$4,$5,$6,7,0,false,$8,$7,null) as result`,
      [reference, overrides.gym ?? IDS.gymA, overrides.member ?? IDS.memberA, IDS.planA,
        overrides.amount ?? 1_000_000, overrides.currency ?? 'NGN', overrides.commission ?? {}, overrides.method ?? 'card'],
    );
    return rows[0].result;
  });
}

async function state() {
  return asSuperuser(async (c) => {
    const { rows } = await c.query<{ end_date: string; payments: string; subscriptions: string }>(`
      select max(end_date)::text as end_date, count(*)::text as subscriptions,
        (select count(*)::text from public.payments where paystack_reference like 'atomic-%') as payments
      from public.member_subscriptions where gym_id=$1 and member_id=$2`, [IDS.gymA, IDS.memberA]);
    return rows[0];
  });
}

beforeEach(async () => {
  await asSuperuser((c) => c.query('delete from public.member_payment_checkouts'));
  await seed();
});

describe('atomic verified payment and paid access', () => {
  it('a payment write failure rolls back the already-computed extension', async () => {
    await reserve(REF);
    const before = await state();
    await expect(settle(REF, { commission: { platform_settlement: 'invalid' } })).rejects.toThrow();
    expect(await state()).toEqual(before);
    expect((await settle(REF)).created).toBe(true);
    expect((await state()).payments).toBe('1');
  });

  it('duplicate webhook and callback on two connections commit one payment and one extension', async () => {
    await reserve(REF);
    const before = await state();
    const results = await Promise.all([settle(REF), settle(REF)]);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    const after = await state();
    expect(after.payments).toBe('1');
    expect(after.subscriptions).toBe('1');
    expect(Date.parse(after.end_date) - Date.parse(before.end_date)).toBe(PERIOD * 86_400_000);
  });

  it('distinct payments settling together preserve both paid periods', async () => {
    await reserve(`${REF}-a`); await reserve(`${REF}-b`);
    const before = await state();
    await Promise.all([settle(`${REF}-a`), settle(`${REF}-b`)]);
    const after = await state();
    expect(after.payments).toBe('2');
    expect(Date.parse(after.end_date) - Date.parse(before.end_date)).toBe(2 * PERIOD * 86_400_000);
  });

  it('an authorized checkout keeps its paid price and term after staff edit the plan', async () => {
    await reserve(REF);
    await asSuperuser((c) => c.query(`update public.membership_plans set price=90000,duration_days=1 where id=$1`, [IDS.planA]));
    const before = await state();
    expect((await settle(REF)).created).toBe(true);
    expect(Date.parse((await state()).end_date) - Date.parse(before.end_date)).toBe(PERIOD * 86_400_000);
  });

  it('unreserved underpayment cannot buy an expensive plan', async () => {
    await expect(settle(REF, { amount: 100 })).rejects.toThrow(/amount|reconciliation/i);
    expect((await state()).payments).toBe('0');
  });

  it.each(['auto_debit', 'bank', 'apple_pay', 'ussd', 'qr', 'mobile_money', 'bank_transfer', 'eft', 'capitec_pay', 'payattitude'])
    ('a verified %s charge is not stranded by the ledger channel constraint', async (method) => {
      await reserve(REF);
      expect((await settle(REF, { method })).created).toBe(true);
      expect((await state()).payments).toBe('1');
    });

  it('replaying a refunded charge cannot claim successful fulfillment again', async () => {
    await reserve(REF); await settle(REF);
    await asSuperuser((c) => c.query("update public.payments set status='refunded',payment_status='refunded' where paystack_reference=$1", [REF]));
    const before = await state();
    await expect(settle(REF)).rejects.toThrow(/not a successful settled charge/i);
    expect(await state()).toEqual(before);
  });

  it('a legacy payment row alone is not proof that paid access was committed', async () => {
    await asSuperuser((c) => c.query(`insert into public.payments
      (gym_id,member_id,plan_id,amount,currency,status,payment_status,paystack_reference)
      values ($1,$2,$3,10000,'NGN','success','successful',$4)`, [IDS.gymA, IDS.memberA, IDS.planA, REF]));
    const before = await state();
    await expect(settle(REF)).rejects.toThrow(/entitlement reconciliation/i);
    expect(await state()).toEqual(before);
  });

  it('rejects currency and checkout tenant/member manipulation', async () => {
    await reserve(REF);
    await expect(settle(REF, { currency: 'USD' })).rejects.toThrow(/Invalid settled/i);
    await expect(settle(REF, { amount: 100 })).rejects.toThrow(/reserved checkout/i);
    await expect(settle(REF, { member: IDS.memberB })).rejects.toThrow(/not active|checkout/i);
    expect((await state()).payments).toBe('0');
  });

  it.each(['anon', 'authenticated'] as const)('%s cannot reserve or directly settle a payment', async (role) => {
    await expect(withSession({ role, uid: IDS.memberA }, (c) => c.query(
      `select public.settle_member_charge($1,$2,$3,$4,100,'NGN',7,0,false,'card','{}',null)`,
      [REF, IDS.gymA, IDS.memberA, IDS.planA],
    ))).rejects.toThrow(/permission denied/i);
    await expect(withSession({ role, uid: IDS.memberA }, (c) => c.query('select * from public.member_payment_checkouts')))
      .rejects.toThrow(/permission denied/i);
  });
});
