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
    expect(readSplit(splitCharge)).toEqual({ settlement: 'split', basis: 'percentage', pct: 10, amountNaira: 500 });
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
    expect(readSplit(noBreakdown)).toEqual({ settlement: 'split', basis: 'percentage', pct: 7.5, amountNaira: 375 });
  });

  it('records no commission when there was no subaccount to split to', () => {
    // The whole charge lands in GymFlow's own account. That is money HELD for
    // the gym, not earned — reporting it as commission is the mistake that made
    // the console's figures wrong to begin with.
    for (const data of [{ amount: 500_000 }, { amount: 500_000, subaccount: null }, { amount: 500_000, subaccount: {} }]) {
      expect(readSplit(data)).toEqual({ settlement: 'platform_only', basis: null, pct: null, amountNaira: null });
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

  // A gym on a flat per-payment fee: lib/paystack.ts sends transaction_charge
  // (kobo) and Paystack routes exactly that to the main account, overriding the
  // subaccount's percentage for this one charge. ₦500 flat on a ₦5,000 payment.
  const flatCharge = {
    amount: 500_000,
    subaccount: { subaccount_code: 'ACCT_x1', business_name: 'Trivion', percentage_charge: 10 },
    fees_split: { paystack: 7_500, integration: 50_000, subaccount: 442_500, params: { bearer: 'subaccount', percentage_charge: 10, transaction_charge: 50_000 } },
  };

  it('records a flat charge as flat, with no rate at all', () => {
    // The percentage on the subaccount is the FALLBACK, not what this charge
    // used. Storing 10% here would invent an arrangement nobody agreed — and it
    // would re-price itself on the next payment of a different size.
    expect(readSplit(flatCharge)).toEqual({ settlement: 'split', basis: 'flat', pct: null, amountNaira: 500 });
  });

  it('falls back to the flat charge when Paystack reported no breakdown', () => {
    const noBreakdown = {
      amount: 500_000,
      subaccount: { subaccount_code: 'ACCT_x1', percentage_charge: 10 },
      transaction_charge: 50_000,
    };
    expect(readSplit(noBreakdown)).toEqual({ settlement: 'split', basis: 'flat', pct: null, amountNaira: 500 });
  });

  it('reads the flat fee off our own metadata when the event does not echo it', () => {
    // Paystack accepts transaction_charge on /transaction/initialize; whether
    // the charge event repeats it is Paystack's choice, and the webhook payload
    // is not the /transaction/verify payload. Without our own record, the
    // absence of an echo demotes a flat charge to "percentage at the
    // subaccount's fallback rate" — 5% and ₦1,000 on a ₦20,000 payment where
    // ₦500 was actually taken. Nothing errors, the CHECK constraint permits it,
    // and the mislabelling is unrecoverable afterwards.
    const noEcho = {
      amount: 2_000_000,
      subaccount: { subaccount_code: 'ACCT_x1', percentage_charge: 5 },
      fees_split: { paystack: 30_000, integration: 50_000, subaccount: 1_920_000, params: { bearer: 'subaccount', percentage_charge: 5 } },
      metadata: { plan_id: 'p1', platform_commission_flat_kobo: 50_000 },
    };
    expect(readSplit(noEcho)).toEqual({ settlement: 'split', basis: 'flat', pct: null, amountNaira: 500 });
  });

  it('prefers what Paystack reported over what we asked for', () => {
    // Our metadata is the intent; an echo from Paystack describes what Paystack
    // actually did, and a charge initialized before a re-mode settles on the
    // older instruction. So the echo is read first.
    const echoed = {
      ...flatCharge,
      metadata: { platform_commission_flat_kobo: 999_999 },
    };
    expect(readSplit(echoed)).toEqual({ settlement: 'split', basis: 'flat', pct: null, amountNaira: 500 });
  });

  it('ignores a metadata figure on an ordinary percentage charge', () => {
    // A percentage-mode checkout never carries the key; junk in metadata (a
    // member-supplied field, on a payload we do not control) must not be able
    // to restate a percentage split as flat.
    const junk = {
      amount: 500_000,
      subaccount: { subaccount_code: 'ACCT_x1', percentage_charge: 10 },
      metadata: { platform_commission_flat_kobo: 'not a number' },
    };
    expect(readSplit(junk)).toEqual({ settlement: 'split', basis: 'percentage', pct: 10, amountNaira: 500 });
  });

  it('treats a zero transaction_charge as an ordinary percentage split', () => {
    // Paystack echoes a 0 on percentage splits; reading that as "flat, ₦0" would
    // strip the rate off every ordinary charge.
    const zeroed = {
      ...flatCharge,
      fees_split: { ...flatCharge.fees_split, params: { bearer: 'subaccount', percentage_charge: 10, transaction_charge: 0 } },
    };
    expect(readSplit(zeroed)).toEqual({ settlement: 'split', basis: 'percentage', pct: 10, amountNaira: 500 });
  });

  it('rejects an out-of-range rate rather than storing it', () => {
    // numeric(5,2) would take 400; a 400% commission would not be true.
    const absurd = { amount: 500_000, subaccount: { subaccount_code: 'ACCT_x1', percentage_charge: 400 } };
    expect(readSplit(absurd)).toEqual({ settlement: 'split', basis: 'percentage', pct: null, amountNaira: null });
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
    expect(commissionColumns({ settlement: 'platform_only', basis: 'percentage', pct: 3, amountNaira: 99 }))
      .toEqual({ platform_settlement: 'platform_only', platform_commission_basis: null, platform_commission_pct: null, platform_commission_amount: null });
    expect(commissionColumns({ settlement: 'offline', basis: 'flat', pct: 3, amountNaira: 99 }))
      .toEqual({ platform_settlement: 'offline', platform_commission_basis: null, platform_commission_pct: null, platform_commission_amount: null });
  });

  it('carries the basis so the console can say ₦500 flat instead of guessing a rate', () => {
    expect(commissionColumns({ settlement: 'split', basis: 'flat', pct: null, amountNaira: 500 }))
      .toEqual({ platform_settlement: 'split', platform_commission_basis: 'flat', platform_commission_pct: null, platform_commission_amount: 500 });
    expect(commissionColumns({ settlement: 'split', basis: 'percentage', pct: 10, amountNaira: 500 }))
      .toEqual({ platform_settlement: 'split', platform_commission_basis: 'percentage', platform_commission_pct: 10, platform_commission_amount: 500 });
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

  it('refuses a staff-written commission basis too', async () => {
    // The basis is a claim about how the PLATFORM's cut was computed. It is not
    // a figure, which is exactly why it was easy to leave out of the guard — a
    // tenant that can label its own payments 'percentage' can make the console
    // describe an arrangement that never applied.
    await expect(insert('platform_commission_basis', ['percentage'])).rejects.toThrow(/cannot be set by a tenant/);
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

describe('the flat-commission columns hold their shape', () => {
  // The CHECK constraint, against the real database — a basis that contradicts
  // the rest of the row is the failure this backs, and it must land here rather
  // than as a 23514 on the money path.
  beforeAll(async () => { await reset(); await seed(); });
  afterAll(async () => { await reset(); });

  const write = (cols: string, values: unknown[]) => asSuperuser((c) => c.query(
    `insert into public.payments (gym_id, member_id, amount, paystack_reference, ${cols})
     values ($1, $2, 5000, 'BASIS-${Math.random().toString(36).slice(2)}'${values.map((_, i) => `, $${i + 3}`).join('')})`,
    [IDS.gymA, IDS.memberA, ...values],
  ));

  it('accepts a flat split with no rate', async () => {
    await expect(write('platform_settlement, platform_commission_basis, platform_commission_amount', ['split', 'flat', 500]))
      .resolves.toBeTruthy();
  });

  it('refuses a flat split that also claims a rate', async () => {
    // A flat charge has no percentage. One that carries both is a row nobody
    // can interpret, and the console would show whichever it happened to read.
    await expect(write('platform_settlement, platform_commission_basis, platform_commission_pct', ['split', 'flat', 10]))
      .rejects.toThrow(/payments_commission_basis_shape/);
  });

  it('refuses a basis on a payment that never split', async () => {
    await expect(write('platform_settlement, platform_commission_basis', ['offline', 'flat']))
      .rejects.toThrow(/payments_commission_basis_shape/);
  });

  it('refuses a basis that is neither', async () => {
    await expect(write('platform_settlement, platform_commission_basis', ['split', 'sometimes']))
      .rejects.toThrow(/payments_commission_basis_shape/);
  });
});

describe('a gym carries its commission arrangement', () => {
  beforeAll(async () => { await reset(); await seed(); });
  afterAll(async () => { await reset(); });

  it('defaults every existing and new gym to the percentage it already had', async () => {
    // The whole safety property of the migration: adding fixed mode changed no
    // gym's behaviour. Seeded gyms predate the columns.
    const { rows } = await asSuperuser((c) => c.query(
      'select platform_commission_mode, platform_commission_fixed_amount from public.gyms where id = $1', [IDS.gymA],
    ));
    expect(rows[0].platform_commission_mode).toBe('percentage');
    expect(Number(rows[0].platform_commission_fixed_amount)).toBe(0);
  });

  it('refuses a mode it has no meaning for, and a negative flat fee', async () => {
    await expect(asSuperuser((c) => c.query(
      "update public.gyms set platform_commission_mode = 'whenever' where id = $1", [IDS.gymA],
    ))).rejects.toThrow(/gyms_platform_commission_mode_check/);
    await expect(asSuperuser((c) => c.query(
      'update public.gyms set platform_commission_fixed_amount = -1 where id = $1', [IDS.gymA],
    ))).rejects.toThrow(/gyms_platform_commission_fixed_amount_check/);
  });
});
