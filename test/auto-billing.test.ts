import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asSuperuser, withSession } from './db';
import { IDS, seed } from './seed';
import { hasLiveMandate, mandateGoneAtPaystack } from '@/lib/member-sub-core';

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

// ── A second mandate on the same card ──────────────────────────────────────
//
// startAutoRenewal called Paystack without ever asking whether the member
// already had a mandate, so tapping it again — on the same plan or a different
// one — created a SECOND live Paystack Subscription against the same card.
// onRecurringCharge then refuses that mandate's charges outright
// ('subscription code conflicts with active mandate', permanent: true) and the
// webhook still acks 200, so Paystack keeps billing: every cycle debits the
// card and produces no payments row, no extension and no receipt.
// lib/reconcile.ts flags it into audit_logs and Sentry and deliberately does
// not fulfil it, so nothing downstream heals it either. The only place that can
// stop it is the opt-in, before the mandate exists.

describe('hasLiveMandate', () => {
  it('is true when one of the member’s live rows already carries auto-debit', () => {
    expect(hasLiveMandate([{ auto_debit_enabled: false }, { auto_debit_enabled: true }])).toBe(true);
  });

  it('is false for a member who has never opted in', () => {
    expect(hasLiveMandate([{ auto_debit_enabled: false }])).toBe(false);
  });

  it('does NOT count the subscription code a cancellation leaves behind', () => {
    // disableSub and the subscription.disable webhook clear auto_debit_enabled
    // and keep paystack_subscription_code cached. Reading the code as "has a
    // mandate" would lock a member out of auto-renew permanently after they
    // once turned it off — the opposite failure, and just as expensive.
    expect(hasLiveMandate([{ auto_debit_enabled: false, paystack_subscription_code: 'SUB_old' } as never])).toBe(false);
  });

  it('treats no rows and no answer as no mandate', () => {
    expect(hasLiveMandate([])).toBe(false);
    expect(hasLiveMandate(null)).toBe(false);
    expect(hasLiveMandate(undefined)).toBe(false);
  });
});

describe('a mandate Paystack has already dropped', () => {
  // The opt-in guard above only refuses a SECOND mandate safely while the first
  // one can still be turned off. disableSub returned early on any Paystack
  // failure without touching auto_debit_enabled, so a member whose local flag
  // outlived the Paystack subscription (a subscription.disable webhook that
  // never landed, a cancellation done from the Paystack dashboard, an
  // email_token we can no longer produce) could neither cancel — the disable
  // call can never succeed — nor opt back in. Permanent, with no self-serve way
  // out, and the refusal copy told them to do the one thing that cannot work.
  it('is what a 4xx from Paystack means, and only a 4xx', () => {
    for (const status of [400, 404, 422]) {
      expect(mandateGoneAtPaystack({ status }), `${status} means Paystack has nothing to disable`).toBe(true);
    }
    // 5xx and a dropped connection are the opposite case: Paystack may well
    // still be billing that card, so the local flag must NOT be cleared on the
    // strength of them.
    for (const res of [{ status: 500 }, { status: 502 }, {}]) {
      expect(mandateGoneAtPaystack(res), `${JSON.stringify(res)} must stay a loud failure`).toBe(false);
    }
  });

  it('clears the local flag instead of dead-ending the member', () => {
    // Source lock, same reason as the describe below: disableSub is behind
    // requireMember/requireStaff and a live Paystack call.
    const src = readFileSync(resolve(__dirname, '..', 'lib/actions/member-billing.ts'), 'utf8');
    // Both failure paths — the email_token refetch and the disable call itself.
    expect(src.match(/mandateGoneAtPaystack\(/g)?.length).toBe(2);
    expect(src).toContain("update({ auto_debit_enabled: false }).eq('id', sub.id)");
    // And it says so rather than reporting a clean cancellation we never got.
    expect(src).toMatch(/Paystack no longer has this subscription/);
  });
});

describe('the auto-renew opt-in refuses a second mandate', () => {
  // Source lock: startAutoRenewal is a 'use server' action behind
  // requireMember() and a live Paystack call, so what is pinned here is that
  // the guard exists, reads the right rows, and runs BEFORE the money path.
  const src = readFileSync(resolve(__dirname, '..', 'lib/actions/member-billing.ts'), 'utf8');

  it('checks for an existing mandate before it asks Paystack for a new one', () => {
    // Order is the whole property: a check after initSubscription would be a
    // subscription Paystack has already created and will already bill.
    const guard = src.indexOf('hasLiveMandate(');
    const init = src.indexOf('await initSubscription(');
    expect(guard).toBeGreaterThan(-1);
    expect(init).toBeGreaterThan(guard);
  });

  it('answers it from the member’s own live subscription rows', () => {
    expect(src).toContain("select('auto_debit_enabled')");
    expect(src).toContain('LIVE_SUB_STATUSES');
    expect(src).toContain('.eq(\'member_id\', user.id).eq(\'gym_id\', gym.id)');
  });

  it('and refuses through the action’s existing error shape, saying what to do', () => {
    expect(src).toMatch(/return \{ ok: false, error: 'Auto-renew is already on[^']*' \};/);
  });
});
