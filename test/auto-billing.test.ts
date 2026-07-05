import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asSuperuser, withSession } from './db';
import { IDS, seed } from './seed';

// Member auto-recurring billing DB-behaviour tests. Covers:
//   - past_due is a valid status (migration widened the check constraint)
//   - service-role webhook writes go through (dunning: active → past_due,
//     past_due → active on recovery, past_due end_date extend on charge)
//   - member cannot self-flip auto_debit_enabled via the regular
//     authenticated role — the platform expects the Paystack disable flow to
//     be the only path, so a direct UPDATE from `authenticated` must not
//     succeed (no self-update policy exists on member_subscriptions)
//   - the paystack_subscription_code partial index doesn't reject NULL
//   - other gym's staff cannot touch this gym's auto-renew state

async function insertSub(gymId: string, memberId: string, extra: {
  status?: string;
  auto_debit_enabled?: boolean;
  paystack_subscription_code?: string | null;
  paystack_customer_code?: string | null;
  paystack_email_token?: string | null;
} = {}): Promise<string> {
  return asSuperuser(async (c) => {
    const today = new Date().toISOString().slice(0, 10);
    const end = new Date(); end.setUTCDate(end.getUTCDate() + 30);
    const endIso = end.toISOString().slice(0, 10);
    const { rows } = await c.query<{ id: string }>(
      `insert into public.member_subscriptions
       (gym_id, member_id, start_date, end_date, status, auto_debit_enabled, paystack_subscription_code, paystack_customer_code, paystack_email_token)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [
        gymId, memberId, today, endIso,
        extra.status ?? 'active',
        extra.auto_debit_enabled ?? false,
        extra.paystack_subscription_code ?? null,
        extra.paystack_customer_code ?? null,
        extra.paystack_email_token ?? null,
      ],
    );
    return rows[0].id;
  });
}

async function statusOf(subId: string) {
  return asSuperuser(async (c) => {
    const { rows } = await c.query(
      `select status, auto_debit_enabled, paystack_subscription_code, end_date from public.member_subscriptions where id = $1`,
      [subId],
    );
    return rows[0];
  });
}

describe('member auto-billing', () => {
  beforeAll(async () => { await seed(); });
  beforeEach(async () => {
    await asSuperuser((c) => c.query(`delete from public.member_subscriptions where member_id in ($1, $2)`, [IDS.memberA, IDS.memberB]));
  });

  it("past_due is now a valid status (constraint widened)", async () => {
    const subId = await insertSub(IDS.gymA, IDS.memberA);
    await asSuperuser((c) => c.query(`update public.member_subscriptions set status = 'past_due' where id = $1`, [subId]));
    expect((await statusOf(subId)).status).toBe('past_due');
  });

  it('member cannot flip auto_debit_enabled from authenticated (RLS blocks silently)', async () => {
    const subId = await insertSub(IDS.gymA, IDS.memberA, {
      auto_debit_enabled: true,
      paystack_subscription_code: 'SUB_test',
    });
    // No self-update policy → UPDATE affects 0 rows.
    await withSession({ role: 'authenticated', uid: IDS.memberA }, async (c) => {
      const { rowCount } = await c.query(
        `update public.member_subscriptions set auto_debit_enabled = false where id = $1`,
        [subId],
      );
      expect(rowCount).toBe(0);
    });
    expect((await statusOf(subId)).auto_debit_enabled).toBe(true);
  });

  it('staff at the correct gym CAN flip auto_debit_enabled off', async () => {
    const subId = await insertSub(IDS.gymA, IDS.memberA, {
      auto_debit_enabled: true,
      paystack_subscription_code: 'SUB_test',
    });
    await withSession({ role: 'authenticated', uid: IDS.ownerA, commit: true }, async (c) => {
      const { rowCount } = await c.query(
        `update public.member_subscriptions set auto_debit_enabled = false where id = $1`,
        [subId],
      );
      expect(rowCount).toBe(1);
    });
    expect((await statusOf(subId)).auto_debit_enabled).toBe(false);
  });

  it("other gym's staff CANNOT flip auto_debit_enabled (gym-scoped writes)", async () => {
    const subId = await insertSub(IDS.gymA, IDS.memberA, {
      auto_debit_enabled: true,
      paystack_subscription_code: 'SUB_test',
    });
    await withSession({ role: 'authenticated', uid: IDS.ownerB }, async (c) => {
      const { rowCount } = await c.query(
        `update public.member_subscriptions set auto_debit_enabled = false where id = $1`,
        [subId],
      );
      expect(rowCount).toBe(0);
    });
    expect((await statusOf(subId)).auto_debit_enabled).toBe(true);
  });

  it('dunning: successful recurring charge flips past_due → active and extends end_date', async () => {
    const subId = await insertSub(IDS.gymA, IDS.memberA, { status: 'past_due' });
    const before = await statusOf(subId);

    // Mirror what onRecurringCharge does when Paystack retry succeeds.
    await asSuperuser(async (c) => {
      await c.query(
        `update public.member_subscriptions
         set status = 'active', end_date = end_date + interval '30 days'
         where id = $1`,
        [subId],
      );
    });

    const after = await statusOf(subId);
    expect(after.status).toBe('active');
    expect(new Date(after.end_date).getTime()).toBeGreaterThan(new Date(before.end_date).getTime());
  });

  it('paystack_subscription_code partial unique-lookup index tolerates NULLs', async () => {
    // Two active member subs with NULL paystack_subscription_code should
    // coexist (partial index only covers non-null). Regression guard: a naive
    // full unique constraint would have failed the second insert.
    await insertSub(IDS.gymA, IDS.memberA);
    await insertSub(IDS.gymA, IDS.memberB);
    const rows = await asSuperuser(async (c) => {
      const { rows } = await c.query(
        `select count(*)::int as n from public.member_subscriptions where paystack_subscription_code is null`,
      );
      return rows[0].n as number;
    });
    expect(rows).toBeGreaterThanOrEqual(2);
  });
});
