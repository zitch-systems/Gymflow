import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asSuperuser, withSession } from './db';
import { IDS, reset, seed } from './seed';
import { commissionColumns, readSplit } from '@/lib/paystack-split';

// What the platform actually kept, recorded on the payment that produced it.
//
// readSplit is pure and gets real unit tests rather than a source scan, because
// the thing that can go wrong is arithmetic and shape-handling on a payload we
// don't control. The call-site locks below are the usual source scans: they
// pin WHERE it is used, which is what silently regresses when someone adds a
// fifth way to record a payment.

const root = (...p: string[]) => resolve(__dirname, '..', ...p);
const read = (path: string) => readFileSync(root(path), 'utf8');

// A charge that routed through a gym's subaccount at 10%, as Paystack reports
// it: ₦5,000 gross, ₦500 kept by the platform, the ₦75 Paystack fee borne by
// the subaccount (bearer: 'subaccount', which lib/paystack.ts always sets).
const splitCharge = {
  amount: 500_000,
  subaccount: { subaccount_code: 'ACCT_x1', business_name: 'Trivion', percentage_charge: 10 },
  fees_split: { paystack: 7_500, integration: 50_000, subaccount: 442_500, params: { bearer: 'subaccount', percentage_charge: 10 } },
};

describe('readSplit', () => {
  it('reads the rate and the naira the platform kept', () => {
    expect(readSplit(splitCharge)).toEqual({ settlement: 'split', pct: 10, amountNaira: 500 });
  });

  it('prefers what this transaction was split on over the subaccount’s current rate', () => {
    // The subaccount object reflects the rate as of the API response, which can
    // already have moved — an operator can re-rate a gym between a member
    // opening a checkout and the charge settling. fees_split.params is what was
    // applied to THIS charge, and that is the whole point of recording it.
    const restated = {
      ...splitCharge,
      subaccount: { ...splitCharge.subaccount, percentage_charge: 25 },
    };
    expect(readSplit(restated).pct).toBe(10);
  });

  it('falls back to the subaccount rate when Paystack reported no breakdown', () => {
    const noBreakdown = { amount: 500_000, subaccount: { subaccount_code: 'ACCT_x1', percentage_charge: 7.5 } };
    expect(readSplit(noBreakdown)).toEqual({ settlement: 'split', pct: 7.5, amountNaira: 375 });
  });

  it('records no commission when there was no subaccount to split to', () => {
    // The whole charge lands in GymFlow's own account. That is money HELD for
    // the gym, not earned — reporting it as commission is the mistake that made
    // the console's figures wrong to begin with.
    for (const data of [{ amount: 500_000 }, { amount: 500_000, subaccount: null }, { amount: 500_000, subaccount: {} }]) {
      expect(readSplit(data)).toEqual({ settlement: 'platform_only', pct: null, amountNaira: null });
    }
  });

  it('never throws on a payload it does not recognise', () => {
    // It runs inside a money-path webhook. A throw here would 500 the webhook
    // and have Paystack redeliver a charge that was otherwise fulfillable.
    for (const junk of [null, undefined, 'nope', 42, [], { subaccount: 'ACCT_x1' }, { subaccount: { subaccount_code: 5 } }]) {
      expect(() => readSplit(junk)).not.toThrow();
      expect(readSplit(junk).settlement).toBe('platform_only');
    }
  });

  it('rejects an out-of-range rate rather than storing it', () => {
    // numeric(5,2) would take 400; a 400% commission would not be true.
    const absurd = { amount: 500_000, subaccount: { subaccount_code: 'ACCT_x1', percentage_charge: 400 } };
    expect(readSplit(absurd)).toEqual({ settlement: 'split', pct: null, amountNaira: null });
  });

  it('rounds to the two decimals the columns actually store', () => {
    const odd = { amount: 333_333, subaccount: { subaccount_code: 'ACCT_x1', percentage_charge: 3.333 } };
    const r = readSplit(odd);
    expect(r.pct).toBe(3.33);
    expect(r.amountNaira).toBe(Math.round(((333_333 * 3.33) / 100 / 100) * 100) / 100);
  });
});

describe('commissionColumns', () => {
  it('writes nothing at all when the caller had nothing to say', () => {
    // Not zeroes. A row with no settlement recorded is unknown, and the console
    // counts it as unknown; writing 0 would claim the platform earned nothing.
    expect(commissionColumns(null)).toEqual({});
  });

  it('leaves the figures null on every settlement that is not a split', () => {
    // Mirrors the CHECK constraint in the migration, so a mismatch fails here
    // rather than as a 23514 on the money path.
    expect(commissionColumns({ settlement: 'platform_only', pct: 3, amountNaira: 99 }))
      .toEqual({ platform_settlement: 'platform_only', platform_commission_pct: null, platform_commission_amount: null });
    expect(commissionColumns({ settlement: 'offline', pct: 3, amountNaira: 99 }))
      .toEqual({ platform_settlement: 'offline', platform_commission_pct: null, platform_commission_amount: null });
  });
});

describe('every path that records a payment records what was split', () => {
  it('one-off charges, from the webhook and from both callbacks', () => {
    const fulfill = read('lib/paystack-fulfill.ts');
    expect(fulfill).toContain('commissionColumns(d.split ?? null)');
    // fulfillCharge is fed by four call sites and each has to hand the split
    // over — whichever of the webhook and the callback wins the race writes the
    // row, so a callback that dropped it would lose the record half the time.
    expect(read('app/api/paystack/webhook/route.ts')).toContain('split: readSplit(d)');
    for (const file of [
      'app/pay/whatsapp/callback/page.tsx',
      'app/api/app/pay/callback/route.ts',
      'app/(member)/dashboard/renew/callback/page.tsx',
    ]) {
      expect(read(file), `${file} must pass the verified split through`).toContain('split: v.split');
    }
    // ...which means verifyTransaction has to carry it back at all.
    expect(read('lib/paystack.ts')).toContain('split: readSplit(d)');
  });

  it('auto-debit renewals, which split exactly like one-off ones', () => {
    expect(read('lib/member-sub-fulfill.ts')).toContain('commissionColumns(readSplit(data))');
  });

  it('cash and transfers taken at the desk say so instead of staying silent', () => {
    // 'offline' and "unknown" are different answers and the console shows them
    // differently: one is a payment the platform was never part of, the other
    // is a gap in the record.
    expect(read('lib/actions/admin-member.ts')).toContain("platform_settlement: 'offline'");
  });
});

describe('a gym cannot write its own commission figures', () => {
  // Against the real database, because the first attempt at this was a
  // column-level REVOKE and Postgres accepted it, warned, and changed nothing —
  // the privilege survived intact under a table-wide grant. A source scan would
  // have called that a pass.
  beforeAll(async () => { await reset(); await seed(); });
  afterAll(async () => { await reset(); });

  const insert = (extra: string, values: unknown[]) =>
    withSession({ role: 'authenticated', uid: IDS.ownerA }, (c) =>
      c.query(
        `insert into public.payments (gym_id, member_id, amount, status, payment_status, paystack_reference${extra ? ', ' + extra : ''})
         values ($1, $2, 5000, 'success', 'successful', 'MANUAL-test'${values.map((_, i) => `, $${i + 3}`).join('')})`,
        [IDS.gymA, IDS.memberA, ...values],
      ));

  it('refuses a staff-written commission figure', async () => {
    // payments_insert_staff exists so the front desk can record cash. Without
    // the trigger that same policy lets a tenant stuff any number into the
    // column the platform's own earnings report sums.
    await expect(insert('platform_settlement, platform_commission_pct, platform_commission_amount', ['split', 90, 4500]))
      .rejects.toThrow(/cannot be set by a tenant/);
  });

  it('refuses it even without a settlement to go with it', async () => {
    await expect(insert('platform_commission_amount', [4500])).rejects.toThrow(/cannot be set by a tenant/);
  });

  it('still lets the front desk record a cash payment', async () => {
    // The guard must not cost the feature it sits next to.
    await expect(insert('platform_settlement', ['offline'])).resolves.toBeTruthy();
  });

  it('and the settlement they can write carries no figures', async () => {
    // The CHECK constraint, not the trigger: 'offline' with a figure attached
    // is refused for everyone, service role included.
    await expect(asSuperuser((c) => c.query(
      `insert into public.payments (gym_id, member_id, amount, paystack_reference, platform_settlement, platform_commission_amount)
       values ($1, $2, 5000, 'CHECK-test', 'offline', 4500)`, [IDS.gymA, IDS.memberA],
    ))).rejects.toThrow(/payments_platform_settlement_shape/);
  });
});
