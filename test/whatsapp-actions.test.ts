import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asSuperuser } from './db';
import { IDS, seed } from './seed';
import { handleInboundMessage } from '@/lib/whatsapp/router';
import { startWhatsAppCheckout } from '@/lib/whatsapp/payments';
import { signGymQrToken } from '@/lib/whatsapp/checkin';
import type { WhatsAppGym } from '@/lib/whatsapp/settings';
import type { IncomingWhatsAppMessage } from '@/lib/whatsapp/inbound';

// What one inbound WhatsApp message is allowed to do — run against the real
// migrations-built database, because both defects here live in the gap between
// what the schema already guarantees and what the code reads back from it.
//
//   1. Meta redelivers any batch it did not see acked, and this webhook does its
//      work synchronously (LLM rounds, Paystack init, several Graph sends) before
//      it can ack. The inbound row's unique (wa_message_id, direction) index was
//      built to make that harmless — but the 23505 was thrown away unread, so the
//      redelivery routed again and checked the member back OUT of the building.
//   2. A checkout could be started for a gym the member has no active link at.
//      Fulfilment refuses that permanently (lib/paystack-fulfill.ts: "member is
//      not active in gym"), so the charge settles into the gym's bank and no day
//      is ever added.

const WA_ID = '2348031234567';
const CONTACT_ID = 'f1111111-1111-1111-1111-111111111111';
const QR_SECRET = 'whatsapp-qr-test-secret';

// Every send is skipped (no WHATSAPP_ACCESS_TOKEN in the suite), but logOutbound
// still records the body — which makes the message log the honest way to assert
// what the member was actually told.
async function lastOutboundBody(): Promise<string | null> {
  return asSuperuser(async (c) => {
    const { rows } = await c.query<{ body: string | null }>(
      `select body from public.whatsapp_messages
       where contact_id = $1 and direction = 'outbound' order by created_at desc, id limit 1`,
      [CONTACT_ID],
    );
    return rows[0]?.body ?? null;
  });
}

async function visits(): Promise<{ id: string; checked_out_at: Date | null }[]> {
  return asSuperuser(async (c) => {
    const { rows } = await c.query<{ id: string; checked_out_at: Date | null }>(
      `select id, checked_out_at from public.check_ins where member_id = $1 and gym_id = $2 order by checked_in_at`,
      [IDS.memberA, IDS.gymA],
    );
    return rows;
  });
}

/** Seed the contact the way a Flow sign-in leaves it: linked, and verified. */
async function seedContact(gymId: string): Promise<void> {
  await asSuperuser(async (c) => {
    await c.query(`delete from public.whatsapp_contacts where id = $1 or wa_id = $2`, [CONTACT_ID, WA_ID]);
    await c.query(
      `insert into public.whatsapp_contacts (id, wa_id, profile_id, active_gym_id, verified_at)
       values ($1, $2, $3, $4, now())`,
      [CONTACT_ID, WA_ID, IDS.memberA, gymId],
    );
  });
}

function inbound(over: Partial<IncomingWhatsAppMessage> = {}): IncomingWhatsAppMessage {
  return {
    from: WA_ID,
    phoneNumberId: '1245745388626014',
    messageId: 'wamid.TEST1',
    kind: 'text',
    text: '',
    actionId: null,
    flowResponse: null,
    contactName: 'Ada',
    timestamp: null,
    ...over,
  };
}

// The door-QR message the printed poster puts in the member's compose box.
const qrText = (slug: string, gymId: string) => `CHECKIN ${slug} ${signGymQrToken(gymId)}`;

const gymRow = async (id: string): Promise<WhatsAppGym> =>
  asSuperuser(async (c) => {
    const { rows } = await c.query<WhatsAppGym>(
      `select id, name, slug, member_code, status, phone, subscription_plan, legacy_full_access,
              paystack_subaccount_code
       from public.gyms where id = $1`,
      [id],
    );
    return rows[0];
  });

// Every fetch the code under test attempts, recorded rather than sent. Nothing
// in this suite may reach Paystack — and for the checkout guard, "no request was
// made at all" is the assertion that matters: the refusal has to come BEFORE the
// member is handed a live payment link. A test that needs an answer back from
// Paystack sets `fetchReply` for the duration.
const fetched: string[] = [];
let fetchReply: (() => unknown) | null = null;
const realFetch = globalThis.fetch;
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ['WHATSAPP_QR_SECRET', 'PAYSTACK_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];

beforeAll(async () => {
  await seed();
  // The WhatsApp member channel and WhatsApp check-in are Growth features
  // (lib/entitlements.ts: whatsapp_reminders, qr_checkin), and seed() creates
  // gyms on the default Starter plan with legacy_full_access=false. These
  // tests are about redelivery, routing and checkout mechanics — not about
  // entitlement — so put both gyms on the plan that actually has the channel.
  // Without this every check-in below is (correctly) refused before it starts.
  await asSuperuser((c) => c.query(
    `update public.gyms set subscription_plan = 'growth' where id = any($1::uuid[])`,
    [[IDS.gymA, IDS.gymB]],
  ));
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.WHATSAPP_QR_SECRET = QR_SECRET;
  // Set, so the "payments aren't configured" guard cannot be what makes a
  // checkout test pass.
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_not_a_real_key';
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetched.push(String(input));
    if (!fetchReply) throw new Error('network disabled in tests');
    return { ok: true, status: 200, json: async () => fetchReply?.() } as Response;
  }) as typeof fetch;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  // The whatsapp tables are outside seed()'s reset list; leaving rows behind
  // would follow this file into whatever runs next.
  await asSuperuser(async (c) => {
    await c.query(`delete from public.whatsapp_payment_intents where contact_id = $1`, [CONTACT_ID]);
    await c.query(`delete from public.whatsapp_contacts where id = $1`, [CONTACT_ID]);
  });
});

beforeEach(() => { fetched.length = 0; fetchReply = null; });

describe('a redelivered inbound message', () => {
  beforeEach(async () => {
    await seedContact(IDS.gymA);
    await asSuperuser((c) => c.query(`delete from public.check_ins where member_id = $1`, [IDS.memberA]));
  });

  it('checks the member in once, however many times Meta delivers it', async () => {
    const msg = inbound({ text: qrText('gym-a', IDS.gymA), messageId: 'wamid.QR-REPLAY' });

    await asSuperuser((c) => handleInboundMessage(pgrest(c) as never, msg));
    await asSuperuser((c) => handleInboundMessage(pgrest(c) as never, msg));

    // One visit, still open. The second delivery used to find that open visit
    // and close it — checking the member out while they were standing inside.
    const rows = await visits();
    expect(rows).toHaveLength(1);
    expect(rows[0].checked_out_at).toBeNull();
    expect(await lastOutboundBody()).toContain('Checked in at Gym A');
  });

  it('is recognised by message id, not by the action looking idempotent', async () => {
    // The control for the test above: a genuinely NEW message from the same
    // member at the same door does toggle them out, so the guard above is the
    // wamid and not check-in being a no-op.
    await asSuperuser((c) => handleInboundMessage(pgrest(c) as never, inbound({ text: qrText('gym-a', IDS.gymA), messageId: 'wamid.QR-1' })));
    await asSuperuser((c) => handleInboundMessage(pgrest(c) as never, inbound({ text: qrText('gym-a', IDS.gymA), messageId: 'wamid.QR-2' })));

    const rows = await visits();
    expect(rows).toHaveLength(1);
    expect(rows[0].checked_out_at).not.toBeNull();
    expect(await lastOutboundBody()).toContain('Checked out of Gym A');
  });

  it('logs the duplicate exactly once, and only for the inbound direction', async () => {
    const msg = inbound({ text: 'menu', messageId: 'wamid.MENU-REPLAY' });
    await asSuperuser((c) => handleInboundMessage(pgrest(c) as never, msg));
    await asSuperuser((c) => handleInboundMessage(pgrest(c) as never, msg));

    const counts = await asSuperuser(async (c) => {
      const { rows } = await c.query<{ direction: string; n: string }>(
        `select direction, count(*) n from public.whatsapp_messages
         where contact_id = $1 group by direction`,
        [CONTACT_ID],
      );
      return Object.fromEntries(rows.map((r) => [r.direction, Number(r.n)]));
    });
    expect(counts.inbound).toBe(1);
    // And the reply was sent once: the duplicate never reached the router.
    expect(counts.outbound).toBe(1);
  });

  it('still routes a message Meta sent no id for', async () => {
    // The unique index is partial (wa_message_id is not null), so an id-less
    // delivery can never collide — and dropping real traffic would be a worse
    // failure than answering it twice.
    await asSuperuser((c) => handleInboundMessage(pgrest(c) as never, inbound({ text: qrText('gym-a', IDS.gymA), messageId: null })));
    await asSuperuser((c) => handleInboundMessage(pgrest(c) as never, inbound({ text: qrText('gym-a', IDS.gymA), messageId: null })));

    const rows = await visits();
    expect(rows).toHaveLength(1);
    expect(rows[0].checked_out_at).not.toBeNull();
  });
});

describe('paying from WhatsApp for a gym you are not a member of', () => {
  // The reachable path: a member of gym A types gym B's member code (or scans
  // its door QR). resolveGym switches active_gym_id with no re-auth, verified_at
  // came over from gym A, and gym B's package list is one tap away.
  beforeEach(async () => { await seedContact(IDS.gymB); });

  it('is refused before Paystack is ever asked for a link', async () => {
    await asSuperuser((c) => handleInboundMessage(pgrest(c) as never, inbound({
      kind: 'list', text: 'Monthly B', actionId: `plan:${IDS.planB}:solo`, messageId: 'wamid.PLAN-B',
    })));

    const body = await lastOutboundBody();
    expect(body).toContain('not a member at Gym B');
    // What the member is told has to be something they can act on.
    expect(body).toContain('front desk');
    expect(fetched).toEqual([]);

    const intents = await asSuperuser(async (c) => {
      const { rows } = await c.query(`select id from public.whatsapp_payment_intents where contact_id = $1`, [CONTACT_ID]);
      return rows.length;
    });
    expect(intents).toBe(0);
  });

  it('refuses a suspended member at their own gym, and says so', async () => {
    await asSuperuser((c) => c.query(
      `update public.gym_member_links set is_active = false where user_id = $1 and gym_id = $2`,
      [IDS.memberA, IDS.gymA],
    ));
    try {
      const gym = await gymRow(IDS.gymA);
      const res = await asSuperuser((c) => startWhatsAppCheckout(pgrest(c) as never, {
        gym, contactId: CONTACT_ID, memberId: IDS.memberA, memberEmail: 'memberA@example.com', planId: IDS.planA,
      }));
      expect(res).toEqual({ ok: false, error: expect.stringContaining('suspended') });
      expect(fetched).toEqual([]);
    } finally {
      await asSuperuser((c) => c.query(
        `update public.gym_member_links set is_active = true where user_id = $1 and gym_id = $2`,
        [IDS.memberA, IDS.gymA],
      ));
    }
  });

  it('has nowhere else to reach Paystack from', () => {
    // The gate is in startWhatsAppCheckout rather than in checkoutReply because
    // a second entry point is exactly how the hole would come back: this channel
    // gets ONE door to Paystack, and the eligibility read stands in front of it.
    const dir = resolve(__dirname, '..', 'lib', 'whatsapp');
    for (const file of readdirSync(dir)) {
      const src = readFileSync(resolve(dir, file), 'utf8');
      if (file === 'payments.ts') {
        expect(src.indexOf("from('gym_member_links')")).toBeLessThan(src.indexOf('initTransaction('));
        continue;
      }
      expect(src, `${file} must go through startWhatsAppCheckout`).not.toContain('initTransaction');
    }
  });

  it('still lets an actively linked member through to Paystack', async () => {
    // The guard has to be the same question fulfilment asks, not a blanket
    // refusal: a member at their own gym must still reach checkout.
    const gym = await gymRow(IDS.gymA);
    const res = await asSuperuser((c) => startWhatsAppCheckout(pgrest(c) as never, {
      gym, contactId: CONTACT_ID, memberId: IDS.memberA, memberEmail: 'memberA@example.com', planId: IDS.planA,
    }));
    expect(fetched).toEqual([expect.stringContaining('/transaction/initialize')]);
    // The stubbed fetch fails, so the outcome is the generic init failure — the
    // point is only that the member got past the eligibility gate.
    expect(res.ok).toBe(false);
  });
});

describe('the page Paystack sends the member back to', () => {
  // The far end of the same checkout. fulfillCharge refuses a member who is not
  // actively linked to the gym — the state above — and this page used to render
  // "Your membership is updated." regardless, so the one member whose payment
  // did NOT land was the one told most confidently that it had.
  //
  // Rendered for real: a server component is just an async function, and the
  // element tree it returns carries the copy. fulfilment is failed here the way
  // an infrastructure failure would fail it (no service-role key), because the
  // eligibility refusal itself needs a database this page cannot be pointed at.
  const verified = () => ({
    status: true,
    data: {
      status: 'success', reference: 'wa-ref-1', amount: 1_000_000, channel: 'card',
      metadata: {
        kind: 'membership_renewal', member_id: IDS.memberA, gym_id: IDS.gymA, plan_id: IDS.planA,
        expected_amount_kobo: 1_000_000, duration_months: 1, source: 'whatsapp',
      },
    },
  });

  const render = async () => {
    const page = (await import('@/app/pay/whatsapp/callback/page')).default;
    return textOf(await page({ searchParams: Promise.resolve({ reference: 'wa-ref-1' }) }));
  };

  it('does not tell a member their membership is updated when it is not', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    fetchReply = verified;
    const text = await render();

    expect(text).not.toContain('Your membership is updated');
    expect(text).toContain('Payment received');
    expect(text).toContain('received your payment');
    // Honest in the other direction too — the charge did happen, so the page may
    // not report a failure — and the reference is what the gym needs to find it.
    expect(text).not.toContain('Payment not completed');
    expect(text).toContain('wa-ref-1');
  });

  it('still calls an uncharged transaction what it is', async () => {
    fetchReply = () => ({ status: true, data: { status: 'abandoned', reference: 'wa-ref-1', amount: 0, metadata: {} } });
    const text = await render();
    expect(text).toContain('Payment not completed');
    expect(text).toContain('No charge was completed');
  });
});

/** The text a rendered server component would put on the page. */
function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  const props = (node as { props?: { children?: unknown } }).props;
  return props ? textOf(props.children) : '';
}

// ── The PostgREST façade ───────────────────────────────────────────────────
// Same device as test/member-sub-extend.test.ts, widened to the router's reads
// and writes: a supabase-js-shaped builder that runs every call as SQL against
// gymflow_test. Nothing here fakes Postgres — the unique indexes, the check-in
// triggers and RLS-exempt service-role access are all the real ones — it only
// stands in for the HTTP layer this suite has no server for.
//
// The column list is deliberately ignored (`select *`): PostgREST's embed
// syntax ("membership_plans(name)") has no SQL equivalent worth writing here,
// and every assertion in this file reads rows back through pg directly.
function pgrest(client: PoolClient) {
  return {
    from(table: string) {
      const where: string[] = [];
      const params: unknown[] = [];
      let tail = '';
      let sets = '';
      let mode: 'select' | 'insert' | 'update' = 'select';
      let cols: string[] = [];

      const p = (v: unknown) => { params.push(v); return `$${params.length}`; };

      const run = async () => {
        const filter = where.length ? ` where ${where.join(' and ')}` : '';
        if (mode === 'insert') {
          return client.query(
            `insert into public.${table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
            params,
          );
        }
        if (mode === 'update') return client.query(`update public.${table} set ${sets}${filter} returning *`, params);
        return client.query(`select * from public.${table}${filter}${tail}`, params);
      };

      const settle = async () => {
        try {
          const { rows } = await run();
          return { data: rows, error: null };
        } catch (e) {
          return { data: null, error: e as { code?: string; message: string } };
        }
      };

      const b = {
        select: () => b,
        insert(row: Record<string, unknown>) {
          mode = 'insert';
          cols = Object.keys(row);
          for (const v of Object.values(row)) p(v);
          return b;
        },
        update(patch: Record<string, unknown>) {
          mode = 'update';
          sets = Object.keys(patch).map((c) => `${c} = ${p(patch[c])}`).join(', ');
          return b;
        },
        eq(col: string, v: unknown) { where.push(`${col} = ${p(v)}`); return b; },
        in(col: string, vs: readonly unknown[]) { where.push(`${col} = any(${p([...vs])})`); return b; },
        is(col: string, v: null) { where.push(`${col} is ${v === null ? 'null' : String(v)}`); return b; },
        gte(col: string, v: unknown) { where.push(`${col} >= ${p(v)}`); return b; },
        lt(col: string, v: unknown) { where.push(`${col} < ${p(v)}`); return b; },
        /** Only the `(a,b)` / `("a","b")` shape the app actually sends. */
        not(col: string, op: string, v: string) {
          if (op !== 'in') throw new Error(`pgrest façade: unsupported not(${op})`);
          const list = v.replace(/^\(|\)$/g, '').split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
          where.push(`${col} <> all(${p(list)})`);
          return b;
        },
        /** PostgREST's `or=(a.eq.1,b.eq.2)`, in the one form this code uses. */
        or(expr: string) {
          const parts = expr.split(',').map((clause) => {
            const [col, op, ...rest] = clause.split('.');
            if (op !== 'eq') throw new Error(`pgrest façade: unsupported or(${op})`);
            return `${col} = ${p(rest.join('.'))}`;
          });
          where.push(`(${parts.join(' or ')})`);
          return b;
        },
        order(col: string, o: { ascending: boolean }) { tail += ` order by ${col} ${o.ascending ? 'asc' : 'desc'}`; return b; },
        limit(n: number) { tail += ` limit ${n}`; return b; },
        async maybeSingle() {
          const { data, error } = await settle();
          return { data: data?.[0] ?? null, error };
        },
        async single() {
          const { data, error } = await settle();
          return { data: data?.[0] ?? null, error: error ?? (data?.length ? null : { message: 'no rows' }) };
        },
        // Awaiting the builder without a terminal is how supabase-js runs a
        // multi-row query (and every write that ignores its return).
        then<T>(resolve: (v: { data: unknown[] | null; error: unknown }) => T) { return settle().then(resolve); },
      };
      return b;
    },
  };
}
