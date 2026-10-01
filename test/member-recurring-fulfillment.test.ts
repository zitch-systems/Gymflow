import type { PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asSuperuser, withSession } from './db';
import { IDS, seed } from './seed';
import { handleMemberSubEvent } from '@/lib/member-sub-fulfill';

const deps = vi.hoisted(() => ({ admin: null as unknown, failBind: false }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => deps.admin }));
vi.mock('@/lib/audit', () => ({ logAudit: async () => undefined }));

// A narrow Supabase transport adapter. All reads, writes, transactions, RLS and
// settlement arithmetic execute in the real migrations-built PostgreSQL DB.
function transport(c: PoolClient) {
  return {
    from(table: string) {
      const params: unknown[] = [], where: string[] = [];
      let order = '', limit = '', patch: Record<string, unknown> | null = null;
      let row: Record<string, unknown> | null = null;
      const param = (v: unknown) => { params.push(v); return `$${params.length}`; };
      const run = async () => {
        if (deps.failBind && patch && table === 'member_subscriptions') {
          return { data: null, error: { message: 'Injected mandate write failure' } };
        }
        let sql: string;
        if (row) {
          sql = `insert into public.${table} (${Object.keys(row).join(',')}) values (${Object.values(row).map(param).join(',')}) returning *`;
        } else if (patch) {
          // Build SET parameters after predicate parameters; placeholders keep
          // their positions and the actual UPDATE executes in PostgreSQL.
          sql = `update public.${table} set ${Object.entries(patch).map(([k,v]) => `${k}=${param(v)}`).join(',')} where ${where.join(' and ')} returning *`;
        } else {
          sql = `select * from public.${table}${where.length ? ` where ${where.join(' and ')}` : ''}${order}${limit}`;
        }
        try { return { data: (await c.query(sql, params)).rows, error: null }; }
        catch (e) { return { data: null, error: e as { message: string } }; }
      };
      const b = {
        select: () => b,
        eq(k: string, v: unknown) { where.push(`${k}=${param(v)}`); return b; },
        in(k: string, v: unknown[]) { where.push(`${k}=any(${param(v)})`); return b; },
        order(k: string, o: { ascending: boolean }) { order = ` order by ${k} ${o.ascending ? 'asc' : 'desc'}`; return b; },
        limit(n: number) { limit = ` limit ${n}`; return b; },
        insert(v: Record<string, unknown>) { row = v; return b; },
        update(v: Record<string, unknown>) { patch = v; return b; },
        async maybeSingle() { const r = await run(); return { data: r.data?.[0] ?? null, error: r.error }; },
        then<T>(resolve: (r: { data: unknown[] | null; error: unknown }) => T) { return run().then(resolve); },
      };
      return b;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      const { rows } = await c.query(`select public.${name}(${Object.keys(args).map((k,i) => `${k}=>$${i+1}`).join(',')}) as result`, Object.values(args));
      return { data: rows[0].result, error: null };
    },
  };
}

const meta = { kind: 'member_subscription', gym_id: IDS.gymA, member_id: IDS.memberA, plan_id: IDS.planA };
const charge = (reference: string, metadata: Record<string, unknown> = meta) => ({
  event: 'charge.success', data: {
    reference, amount: 1_000_000, currency: 'NGN', metadata,
    subscription: { subscription_code: 'SUB_first_member' },
    customer: { customer_code: 'CUS_first_member' },
    plan: { plan_code: 'PLN_week', amount: 1_000_000, currency: 'NGN', interval: 'weekly' },
  },
});
const event = (e: Record<string, unknown>) => withSession({ role: 'service_role', commit: true }, async (c) => {
  deps.admin = transport(c);
  return handleMemberSubEvent(e);
});
async function paidState() {
  return asSuperuser(async (c) => {
    const { rows } = await c.query(`select id, end_date::text, paystack_subscription_code, auto_debit_enabled,
      (select count(*)::int from public.payments where paystack_reference like 'first-member-%') as payments
      from public.member_subscriptions where member_id=$1 and gym_id=$2`, [IDS.memberA, IDS.gymA]);
    return rows;
  });
}
beforeEach(async () => {
  deps.failBind = false;
  await seed();
  await asSuperuser(async (c) => {
    await c.query('delete from public.member_subscriptions where member_id=$1', [IDS.memberA]);
    await c.query("update public.membership_plans set paystack_plan_code='PLN_week' where id=$1", [IDS.planA]);
    await c.query(`insert into public.member_payment_checkouts
      (reference, gym_id, member_id, plan_id, amount_kobo, duration_days, duration_months, provider_plan_code)
      values ('first-member-initial',$1,$2,$3,1000000,7,0,'PLN_week')`, [IDS.gymA, IDS.memberA, IDS.planA]);
  });
});

describe('first recurring payment and mandate repair', () => {
  it('creates and credits a never-subscribed member, and a replay does not extend twice', async () => {
    expect((await event(charge('first-member-initial'))).ok).toBe(true);
    const first = await paidState();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ payments: 1, paystack_subscription_code: 'SUB_first_member', auto_debit_enabled: true });
    expect((await event(charge('first-member-initial'))).ok).toBe(true);
    expect(await paidState()).toEqual(first);
  });

  it('a subscription.create before the initial charge requests retry instead of losing cancellation codes', async () => {
    const create = { event: 'subscription.create', data: {
      metadata: meta, subscription_code: 'SUB_first_member', email_token: 'email_test_token',
      customer: { customer_code: 'CUS_first_member' },
    } };
    expect((await event(create)).ok).toBe(false);
    expect(await paidState()).toHaveLength(0);
    await event(charge('first-member-initial'));
    expect((await event(create)).ok).toBe(true);
  });

  it('retry repairs a failed mandate bind after credit without extending access again', async () => {
    deps.failBind = true;
    expect((await event(charge('first-member-initial'))).ok).toBe(false);
    const credited = await paidState();
    expect(credited[0].payments).toBe(1);
    deps.failBind = false;
    expect((await event(charge('first-member-initial'))).ok).toBe(true);
    const repaired = await paidState();
    expect(repaired[0].end_date).toBe(credited[0].end_date);
    expect(repaired[0].payments).toBe(1);
    expect(repaired[0].paystack_subscription_code).toBe('SUB_first_member');
  });

  it('a later weekly cycle keeps seven paid days after staff shorten the local plan', async () => {
    await event(charge('first-member-initial'));
    const before = (await paidState())[0];
    await asSuperuser((c) => c.query('update public.membership_plans set duration_days=1,duration_months=0 where id=$1', [IDS.planA]));
    expect((await event(charge('first-member-next', {}))).ok).toBe(true);
    const after = (await paidState())[0];
    expect(Date.parse(after.end_date) - Date.parse(before.end_date)).toBe(7 * 86_400_000);
    expect(after.payments).toBe(2);
  });

  it('an initial paid checkout survives plan edits that clear the current cached provider code', async () => {
    await asSuperuser((c) => c.query('update public.membership_plans set price=90000,duration_days=1,paystack_plan_code=null where id=$1', [IDS.planA]));
    expect((await event(charge('first-member-initial'))).ok).toBe(true);
    expect((await paidState())[0].payments).toBe(1);
  });

  it.each(['paused', 'pause_requested', 'cancelled'])('a failed debit and mandate end do not reactivate %s access', async (status) => {
    await event(charge('first-member-initial'));
    await asSuperuser((c) => c.query('update public.member_subscriptions set status=$2 where member_id=$1', [IDS.memberA, status]));
    for (const name of ['invoice.payment_failed', 'subscription.disable']) {
      expect((await event({ event: name, data: { subscription_code: 'SUB_first_member' } })).ok).toBe(true);
      const current = await asSuperuser(async (c) => (await c.query('select status from public.member_subscriptions where member_id=$1', [IDS.memberA])).rows[0].status);
      expect(current).toBe(status);
    }
  });
});
