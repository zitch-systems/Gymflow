import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { asSuperuser, withSession } from './db';
import { IDS, seed } from './seed';

// Paystack refund + dispute handling (lib/paystack-refund.ts). This is the last
// money path that flips a payment row without a suite behind it: every other
// one (payouts, commission, platform charges, the replay ledger, transfer state)
// has one, and the refund handler is the one that can mark a *successful*
// payment as money-returned.
//
// The module talks to Postgres through the service-role Supabase client, so the
// tests substitute a client that speaks the same fluent shape
// (`.from().update().eq().select()`) but runs the statement against the real
// gymflow_test database as the real `service_role` Postgres role. That keeps the
// module itself untouched — the branching, the reference extraction and the
// table fallthrough are all the shipped code — while the writes are exercised
// against the real columns, the real check constraint and the real
// sync_payment_status trigger. Running as service_role rather than the pool's
// superuser also pins that the role Paystack webhooks actually run as still
// holds UPDATE on both payment tables; a revoked grant would make refunds fail
// silently in production and nowhere else.

const auditCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('@/lib/audit', () => ({
  logAudit: async (entry: Record<string, unknown>) => { auditCalls.push(entry); },
}));

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fakeAdmin() }));

// Minimal stand-in for the one PostgREST call shape the module uses. Table and
// column names are interpolated because they come from the module's own source,
// never from event data; the matched value is bound.
function fakeAdmin() {
  return {
    from: (table: string) => ({
      update: (values: Record<string, unknown>) => ({
        eq: (column: string, value: unknown) => ({
          select: async (columns: string) => {
            const keys = Object.keys(values);
            const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
            const sql =
              `update public.${table} set ${sets} where ${column} = $${keys.length + 1} returning ${columns}`;
            try {
              // commit: true — the handler's write has to survive for the
              // assertions (and for the replay case) to see it.
              const rows = await withSession({ role: 'service_role', commit: true }, async (c) => {
                const res = await c.query(sql, [...keys.map((k) => values[k]), value]);
                return res.rows;
              });
              return { data: rows, error: null };
            } catch (e) {
              // PostgREST reports failures in-band, not by throwing.
              return { data: null, error: { message: (e as Error).message } };
            }
          },
        }),
      }),
    }),
  };
}

const { handleRefundEvent, isRefundEvent } = await import('@/lib/paystack-refund');

const MEMBER_REF = 'ref-refund-member';
const PLATFORM_REF = 'ref-refund-platform';

async function seedPayments() {
  await asSuperuser(async (c) => {
    await c.query(
      `insert into public.payments (gym_id, member_id, amount, currency, status, payment_status, paystack_reference)
       values ($1, $2, 10000, 'NGN', 'success', 'successful', $3)`,
      [IDS.gymA, IDS.memberA, MEMBER_REF],
    );
    await c.query(
      `insert into public.platform_payments
         (gym_id, amount, payment_status, paystack_reference, billing_period_start, billing_period_end)
       values ($1, 20000, 'successful', $2, current_date, current_date + 30)`,
      [IDS.gymB, PLATFORM_REF],
    );
  });
}

async function statuses() {
  return asSuperuser(async (c) => {
    const member = await c.query(
      `select payment_status, status from public.payments where paystack_reference = $1`,
      [MEMBER_REF],
    );
    const platform = await c.query(
      `select payment_status::text as payment_status from public.platform_payments where paystack_reference = $1`,
      [PLATFORM_REF],
    );
    return { member: member.rows[0], platform: platform.rows[0] };
  });
}

// The shapes Paystack actually posts. A dispute carries the original charge on
// data.transaction; an async refund carries it as data.transaction_reference.
const chargeRefund = (reference: string) => ({ event: 'charge.refund', data: { reference, status: 'processed' } });
const refundProcessed = (reference: string) => ({
  event: 'refund.processed',
  data: { status: 'processed', transaction_reference: reference, refund_reference: 'RF_1', amount: '10000' },
});
const disputeResolve = (reference: string, resolution: string) => ({
  event: 'charge.dispute.resolve',
  data: { status: 'resolved', resolution, transaction: { reference } },
});

describe('paystack refunds', () => {
  beforeAll(async () => { await seed(); });

  afterEach(async () => {
    auditCalls.length = 0;
    await asSuperuser(async (c) => {
      await c.query(`delete from public.payments where paystack_reference = $1`, [MEMBER_REF]);
      await c.query(`delete from public.platform_payments where paystack_reference = $1`, [PLATFORM_REF]);
    });
  });

  describe('isRefundEvent', () => {
    it('claims the refund and dispute-resolution events, and nothing else', () => {
      for (const e of ['charge.refund', 'refund.processed', 'refund.pending', 'refund.failed', 'charge.dispute.resolve']) {
        expect(isRefundEvent({ event: e })).toBe(true);
      }
      // charge.success and the transfer/subscription families are routed to
      // other handlers by the webhook; claiming one here would swallow it.
      for (const e of ['charge.success', 'transfer.reversed', 'subscription.disable', 'charge.dispute.create', '']) {
        expect(isRefundEvent({ event: e })).toBe(false);
      }
      expect(isRefundEvent({})).toBe(false);
    });
  });

  it('flips a member payment to refunded and audits it', async () => {
    await seedPayments();
    const result = await handleRefundEvent(chargeRefund(MEMBER_REF));
    expect(result).toEqual({ ok: true });

    const after = await statuses();
    expect(after.member.payment_status).toBe('refunded');
    // sync_payment_status mirrors the legacy `status` column; the handler sets
    // both explicitly, so they must agree either way.
    expect(after.member.status).toBe('refunded');
    // The platform table is a different tenant's row and must be untouched.
    expect(after.platform.payment_status).toBe('successful');

    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]).toMatchObject({ action: 'charge.refund', table: 'payments', gymId: IDS.gymA });
    expect((auditCalls[0].values as Record<string, unknown>).member_id).toBe(IDS.memberA);
  });

  it('falls through to platform_payments when the reference is a SaaS charge', async () => {
    await seedPayments();
    // refund.processed carries the original charge as transaction_reference —
    // there is no data.reference on this shape at all.
    const result = await handleRefundEvent(refundProcessed(PLATFORM_REF));
    expect(result).toEqual({ ok: true });

    const after = await statuses();
    expect(after.platform.payment_status).toBe('refunded');
    expect(after.member.payment_status).toBe('successful');

    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]).toMatchObject({ action: 'refund.processed', table: 'platform_payments', gymId: IDS.gymB });
  });

  it('acks a reference in neither table without throwing or touching a row', async () => {
    await seedPayments();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // A refund for a charge this integration never fulfilled (foreign
      // transaction, or the refund overtook the charge). Retrying can't help,
      // so it must ack rather than 500 forever.
      const result = await handleRefundEvent(chargeRefund('ref-refund-nobody'));
      expect(result).toEqual({ ok: true });
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }

    const after = await statuses();
    expect(after.member.payment_status).toBe('successful');
    expect(after.platform.payment_status).toBe('successful');
    expect(auditCalls).toHaveLength(0);
  });

  it('reports a missing reference as permanent so the webhook stops retrying', async () => {
    const result = await handleRefundEvent({ event: 'charge.refund', data: { status: 'processed' } });
    expect(result.ok).toBe(false);
    expect(result.permanent).toBe(true);
    expect(auditCalls).toHaveLength(0);
  });

  describe('dispute resolution', () => {
    it('refunds when the merchant lost the dispute', async () => {
      await seedPayments();
      // Paystack's resolve-dispute vocabulary: 'merchant-accepted' means the
      // merchant accepted the chargeback, i.e. the buyer's money went back.
      // This is the ONLY resolution Paystack sends for a lost dispute, and it
      // is the one the money actually moved on.
      const result = await handleRefundEvent(disputeResolve(MEMBER_REF, 'merchant-accepted'));
      expect(result).toEqual({ ok: true });
      expect((await statuses()).member.payment_status).toBe('refunded');
      expect(auditCalls[0]).toMatchObject({ action: 'charge.dispute.resolve', table: 'payments' });
    });

    it('leaves the payment alone when the merchant won the dispute', async () => {
      // 'declined' = merchant contested and kept the money. 'merchant-declined'
      // is the same outcome spelled long-hand; neither may refund the payment.
      for (const resolution of ['declined', 'merchant-declined', 'pending', '']) {
        await seedPayments();
        const result = await handleRefundEvent(disputeResolve(MEMBER_REF, resolution));
        expect(result, resolution).toEqual({ ok: true });
        expect((await statuses()).member.payment_status, resolution).toBe('successful');
        expect(auditCalls, resolution).toHaveLength(0);
        await asSuperuser((c) => c.query(`delete from public.payments where paystack_reference = $1`, [MEMBER_REF]));
        await asSuperuser((c) => c.query(`delete from public.platform_payments where paystack_reference = $1`, [PLATFORM_REF]));
      }
    });
  });

  it('acks the informational-only refund events without changing status', async () => {
    // refund.pending (accepted, not settled) and refund.failed (the original
    // charge stands) must not mark anything refunded.
    for (const event of ['refund.pending', 'refund.failed'] as const) {
      await seedPayments();
      const result = await handleRefundEvent({ event, data: { transaction_reference: MEMBER_REF } });
      expect(result, event).toEqual({ ok: true });
      expect((await statuses()).member.payment_status, event).toBe('successful');
      expect(auditCalls, event).toHaveLength(0);
      await asSuperuser((c) => c.query(`delete from public.payments where paystack_reference = $1`, [MEMBER_REF]));
      await asSuperuser((c) => c.query(`delete from public.platform_payments where paystack_reference = $1`, [PLATFORM_REF]));
    }
  });

  it('is safe to re-deliver — a replay lands on the same state', async () => {
    await seedPayments();
    // Paystack retries until it sees a 200, and the replay ledger only records
    // byte-identical bodies. A second delivery must be a no-op, not an error.
    expect(await handleRefundEvent(chargeRefund(MEMBER_REF))).toEqual({ ok: true });
    expect(await handleRefundEvent(chargeRefund(MEMBER_REF))).toEqual({ ok: true });
    const after = await statuses();
    expect(after.member.payment_status).toBe('refunded');
    expect(after.member.status).toBe('refunded');
    // Exactly one payment row still exists — nothing was inserted or duplicated.
    const count = await asSuperuser(async (c) => {
      const { rows } = await c.query(`select count(*)::int as n from public.payments where paystack_reference = $1`, [MEMBER_REF]);
      return rows[0].n;
    });
    expect(count).toBe(1);
  });

  it('does NOT reverse the membership the refunded payment paid for', async () => {
    await seedPayments();
    // Documented at lib/paystack-refund.ts:9-14: refund policy (partial
    // refunds, goodwill credits, chargeback vs merchant-initiated) is an
    // operator decision, so the handler makes the refund visible and stops.
    // Silently expiring a member's access from a webhook is the behaviour this
    // pins against.
    const before = await asSuperuser(async (c) => {
      const { rows } = await c.query(
        `select status, end_date from public.member_subscriptions where member_id = $1`,
        [IDS.memberA],
      );
      return rows;
    });
    expect(before.length).toBeGreaterThan(0);

    await handleRefundEvent(chargeRefund(MEMBER_REF));

    const after = await asSuperuser(async (c) => {
      const { rows } = await c.query(
        `select status, end_date from public.member_subscriptions where member_id = $1`,
        [IDS.memberA],
      );
      return rows;
    });
    expect(after).toEqual(before);
  });
});
