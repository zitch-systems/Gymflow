import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  editorMode, parseCommission, MAX_FIXED_COMMISSION_NAIRA, type CommissionMode,
} from '../lib/commission-settings';
import { initTransaction } from '../lib/paystack';

// The platform's cut of member dues.
//
// Two things went wrong here at once and they wore the same face. A rate typed
// into the console appeared not to stick, and the platform appeared not to earn
// anything — and the UI could not tell an operator which of those they were
// looking at, because a failed save signalled itself only through a tooltip and
// a swapped icon.
//
// The mechanism worth remembering: the commission is applied by Paystack at
// settlement, via the `percentage_charge` on the gym's subaccount. So the
// number in gyms.platform_commission_pct earns nothing at all until that
// subaccount exists — a gym that has not connected payouts settles the WHOLE
// charge into the platform account, which is a different arrangement, not a
// smaller one.
//
// Because that rate lives on a mutable subaccount and Paystack keeps no
// per-charge history of it, what was split has to be captured AT FULFILMENT or
// it is gone. It used to be gone, and the console papered over the gap by
// multiplying today's rate by all historical GMV — so re-rating a gym silently
// re-priced every payment it had ever taken.

const root = (...p: string[]) => resolve(__dirname, '..', ...p);
const read = (path: string) => readFileSync(root(path), 'utf8');

describe('setGymCommission', () => {
  const src = read('lib/actions/platform-gym.ts');
  const fn = src.slice(src.indexOf('export async function setGymCommission'), src.indexOf('// ── Shared plumbing'));

  it('revalidates the console before anything that can fail', () => {
    // An earlier version returned on a Paystack error BEFORE revalidating, so
    // the rate was saved, the page kept rendering the old number, and the
    // operator was told the save had failed. Three states, one screen.
    const revalidateAt = fn.indexOf('revalidateGym(gymId)');
    const paystackAt = fn.indexOf('updateSubaccountCommission(');
    expect(revalidateAt).toBeGreaterThan(0);
    expect(paystackAt).toBeGreaterThan(0);
    expect(revalidateAt).toBeLessThan(paystackAt);
  });

  it('audits before anything that can fail, for the same reason', () => {
    expect(fn.indexOf('logAudit(')).toBeLessThan(fn.indexOf('updateSubaccountCommission('));
  });

  it('echoes back the rate as stored, not as typed', () => {
    // `.select()` on the UPDATE returns the row; a save that silently didn't
    // stick is the failure hardest to see from the outside.
    expect(fn).toContain("select('platform_commission_pct, platform_commission_mode, platform_commission_fixed_amount, paystack_subaccount_code')");
    expect(fn).toMatch(/pct: stored/);
  });

  it('says so when the rate splits nothing', () => {
    // No subaccount means no split exists to carry the rate. Reporting a bare
    // "commission updated" there is a lie of omission.
    expect(fn).toContain('notSplitting: true');
    expect(fn).toMatch(/if \(!subaccount\)/);
    expect(fn).toMatch(/hasn’t connected payouts/);
  });

  it('reports a Paystack rejection as a failure, while keeping the saved value', () => {
    expect(fn).toMatch(/Paystack rejected the split change/);
    // `label` is the arrangement in the operator's own terms — "5%" or
    // "₦500 per payment" — so the message describes what they actually set.
    expect(fn).toMatch(/Saved \$\{label\} in GymFlow/);
  });

  it('persists a Paystack rejection so the reconciliation sweep can find it later', () => {
    // The ephemeral action-state error is lost on reload; without a persisted
    // record a gym stayed out of sync until someone re-opened the editor to
    // reproduce the failure. See lib/reconcile.ts reconcileGymSplits.
    const rejectAt = fn.indexOf('Paystack rejected the split change');
    const persistAt = fn.indexOf('paystack_sync_error: r.error');
    expect(persistAt).toBeGreaterThan(0);
    expect(persistAt).toBeLessThan(rejectAt);
  });

  it('clears the persisted sync error once the push succeeds', () => {
    const successAt = fn.indexOf('Commission updated to');
    const clearAt = fn.indexOf('paystack_sync_error: null');
    expect(clearAt).toBeGreaterThan(0);
    expect(clearAt).toBeLessThan(successAt);
  });
});

describe('setGymCommission in fixed mode', () => {
  const src = read('lib/actions/platform-gym.ts');
  const fn = src.slice(src.indexOf('export async function setGymCommission'), src.indexOf('// ── Shared plumbing'));

  it('runs the operator’s input through the shared rules', () => {
    // The rules themselves are exercised below, against the function rather
    // than against the source text. What this pins is that the action has not
    // grown a second, looser copy of them.
    expect(fn).toContain('parseCommission(');
    expect(fn).toMatch(/if \(parsed\.value === null\) return \{ ok: false, error: parsed\.error \}/);
  });

  it('still pushes the percentage to Paystack in fixed mode', () => {
    // The flat fee rides per-charge as transaction_charge; the subaccount's
    // percentage is the fallback for any charge that arrives without one, so
    // it must keep being maintained. There is no mode branch around the push.
    const pushAt = fn.indexOf('updateSubaccountCommission(subaccount, stored)');
    expect(pushAt).toBeGreaterThan(0);
    expect(fn.slice(0, pushAt)).not.toMatch(/if \(storedMode === 'fixed'\) return/);
  });

  it('echoes back the mode and the flat amount as stored, not as typed', () => {
    expect(fn).toContain("select('platform_commission_pct, platform_commission_mode, platform_commission_fixed_amount, paystack_subaccount_code')");
    expect(fn).toMatch(/storedMode/);
    expect(fn).toMatch(/storedFixed/);
  });

  it('audits all three, so the arrangement on a given date is recoverable', () => {
    expect(fn).toMatch(/values: \{ pct: stored, mode: storedMode, fixed: storedFixed \}/);
    // ...and still before anything that can fail, as the percentage path does.
    expect(fn.indexOf('logAudit(')).toBeLessThan(fn.indexOf('updateSubaccountCommission('));
  });

  it('quotes the flat fee, not the percentage the row still carries', () => {
    // In fixed mode the stored percentage is not the deal. Reporting "Saved 5%"
    // after setting ₦500 flat would describe the wrong arrangement.
    expect(fn).toMatch(/per payment/);
    expect(fn).toMatch(/storedMode === 'fixed' \? `₦/);
  });
});

describe('the commission editor', () => {
  const src = read('components/superadmin/commission-editor.tsx');

  it('shows the outcome instead of hinting at it', () => {
    // The old version carried its only error surface in a `title` tooltip.
    expect(src).not.toMatch(/title=\{state\.error/);
    expect(src).toContain('aria-live');
    expect(src).toContain('state.message');
  });

  it('warns when the gym has no payout split', () => {
    expect(src).toContain('splitting');
    expect(src).toMatch(/No payout split/);
  });

  it('trusts the action’s freshly-read state over the rendered prop', () => {
    expect(src).toMatch(/state\.notSplitting === undefined \? splitting/);
    expect(src).toMatch(/defaultValue=\{state\.pct \?\? pct\}/);
  });
});

describe('what an operator typed', () => {
  // parseCommission is the whole rule set for a commission save. It is pure so
  // it can be exercised for real: a regex over the action's source passes just
  // as happily with the guard's body emptied out.

  it('defaults to the arrangement every gym already has', () => {
    // An older form post, or anything that only knows about a rate, must keep
    // meaning what it always meant rather than failing validation.
    expect(parseCommission({ pct: '5' }).value).toEqual({ mode: 'percentage', pct: 5, fixed: 0 });
  });

  it('refuses a mode it does not recognise rather than picking one', () => {
    expect(parseCommission({ mode: 'whenever', pct: '5' }).error).toMatch(/percentage or a fixed amount/);
  });

  it('holds the percentage to 0–100 whichever mode is live', () => {
    for (const pct of ['-1', '101', '100.01', 'abc']) {
      expect(parseCommission({ mode: 'percentage', pct }).error, `pct=${pct}`).toMatch(/between 0 and 100/);
      // ...and in fixed mode too: the percentage is still written to the row as
      // Paystack's fallback, so a stray charge can settle on it.
      expect(parseCommission({ mode: 'fixed', pct, fixed: '500' }).error, `fixed-mode pct=${pct}`).toMatch(/between 0 and 100/);
    }
    expect(parseCommission({ mode: 'percentage', pct: '0' }).value).toEqual({ mode: 'percentage', pct: 0, fixed: 0 });
    expect(parseCommission({ mode: 'percentage', pct: '100' }).value?.pct).toBe(100);
    // An empty box is 0, as it always was — the form omits the input entirely
    // in fixed mode, and that must not read as "invalid rate".
    expect(parseCommission({ mode: 'percentage', pct: '' }).value?.pct).toBe(0);
  });

  it('holds the flat amount to something a gym could really owe', () => {
    expect(parseCommission({ mode: 'fixed', pct: '5', fixed: '-1' }).error).toMatch(/₦0 or more/);
    expect(parseCommission({ mode: 'fixed', pct: '5', fixed: 'abc' }).error).toMatch(/₦0 or more/);
    expect(parseCommission({ mode: 'fixed', pct: '5', fixed: String(MAX_FIXED_COMMISSION_NAIRA + 1) }).error)
      .toMatch(/looks wrong/);
    // ...and the ceiling itself is allowed, so the message is about the typo it
    // is meant to catch rather than an off-by-one nobody can see.
    expect(parseCommission({ mode: 'fixed', pct: '5', fixed: String(MAX_FIXED_COMMISSION_NAIRA) }).error).toBeNull();
  });

  it('checks the flat amount even when the percentage is the live one', () => {
    // Both numbers land on the row. Letting a nonsense one through because it
    // is "not in use" leaves it one mode switch — or one fallback charge —
    // away from being exactly the one in use.
    expect(parseCommission({ mode: 'percentage', pct: '5', fixed: '-40' }).error).toMatch(/₦0 or more/);
  });

  it('refuses a fixed commission of zero, which would earn nothing', () => {
    expect(parseCommission({ mode: 'fixed', pct: '5', fixed: '0' }).error).toMatch(/earns nothing/);
    expect(parseCommission({ mode: 'fixed', pct: '5', fixed: '' }).error).toMatch(/earns nothing/);
    // ₦0 in percentage mode is a real setting — a gym charged nothing.
    expect(parseCommission({ mode: 'percentage', pct: '0', fixed: '0' }).error).toBeNull();
  });

  it('reports the reason instead of a value, and a value instead of a reason', () => {
    // The action returns one or the other straight to the operator; a parse
    // that produced both would let a rejected save write a row.
    expect(parseCommission({ mode: 'fixed', pct: '5', fixed: '0' }).value).toBeNull();
    expect(parseCommission({ mode: 'fixed', pct: '5', fixed: '500' })).toEqual({
      error: null, value: { mode: 'fixed', pct: 5, fixed: 500 },
    });
  });
});

describe('the editor’s mode toggle', () => {
  // The one rule the toggle has, and the one that cannot be read off the
  // source: the mode a save STORED is adopted once — the operator may have
  // been looking at a stale render, or their input may have been coerced —
  // and after they have seen it, their own next selection wins again.
  //
  // `state.mode ?? draftMode` reads like that rule and is not it. Because
  // useActionState state survives the revalidate, the editor is never
  // remounted and the first save pins the select for the life of the page.
  const start = { draft: 'percentage' as CommissionMode, adopted: null };

  it('shows the operator’s selection before any save has returned', () => {
    expect(editorMode({ draft: 'fixed', adopted: null }, undefined).mode).toBe('fixed');
  });

  it('adopts what the save actually stored', () => {
    expect(editorMode(start, 'fixed')).toEqual({ mode: 'fixed', adopted: 'fixed' });
  });

  it('lets the operator switch mode again after a save — the freeze', () => {
    // Save (stored 'fixed'), then pick '%'. This is the whole failure: with
    // the saved mode preferred outright, the select snapped back to ₦ and the
    // hidden input kept submitting 'fixed' until the page was reloaded.
    const afterSave = editorMode(start, 'fixed');
    const afterSwitch = editorMode({ draft: 'percentage', adopted: afterSave.adopted }, 'fixed');
    expect(afterSwitch.mode).toBe('percentage');
    // ...and it stays switched across the re-renders the revalidate causes.
    expect(editorMode({ draft: 'percentage', adopted: afterSwitch.adopted }, 'fixed').mode).toBe('percentage');
  });

  it('adopts the next save too, so a coerced value is still shown', () => {
    const afterSave = editorMode(start, 'fixed');
    const switched = editorMode({ draft: 'percentage', adopted: afterSave.adopted }, 'fixed');
    expect(editorMode({ draft: 'percentage', adopted: switched.adopted }, 'percentage'))
      .toEqual({ mode: 'percentage', adopted: 'percentage' });
  });

  it('keeps the selection when a save comes back without a mode at all', () => {
    // A rejected save ("Missing gym.") returns no echo. The operator's screen
    // must not silently revert underneath the error message.
    expect(editorMode({ draft: 'fixed', adopted: 'percentage' }, undefined).mode).toBe('fixed');
  });
});

describe('the editor', () => {
  const src = read('components/superadmin/commission-editor.tsx');

  it('submits the mode it is showing', () => {
    // Both the select and the hidden input read the same resolved value, so
    // what the operator sees is what the action receives.
    expect(src).toMatch(/name="mode" value=\{activeMode\}/);
    expect(src).toMatch(/value=\{activeMode\} disabled=\{pending\}/);
    expect(src).toContain('editorMode(');
    // The frozen expression, by name — it is subtle enough to come back.
    expect(src).not.toMatch(/state\.mode \?\? draftMode/);
  });

  it('offers a labelled mode toggle', () => {
    // A native select, so it carries its own role and keyboard handling — and
    // it is named, because "%/₦" alone tells a screen reader nothing.
    expect(src).toMatch(/<select/);
    expect(src).toContain("aria-label=\"Commission type\"");
  });

  it('shows one input, matching the mode', () => {
    // Two boxes side by side would leave the operator guessing which number is
    // the one being charged.
    expect(src).toMatch(/activeMode === 'fixed' \?/);
    expect(src).toContain('Fixed platform commission in naira per payment');
    expect(src).toContain('Platform commission percent');
  });

  it('submits the inactive value unchanged instead of dropping it', () => {
    // The percentage is Paystack's fallback even in fixed mode; a save that
    // omitted it would zero the rate a stray charge falls back to.
    expect(src).toMatch(/type="hidden" name="pct"/);
    expect(src).toMatch(/type="hidden" name="fixed"/);
  });

  it('keeps every state it already showed', () => {
    expect(src).toContain('aria-live');
    expect(src).toMatch(/No payout split/);
    expect(src).toMatch(/aria-label="Save commission"/);
  });
});

describe('every door a member can pay through charges the same commission', () => {
  it('the web renewal, the app renewal and the WhatsApp checkout all send it', () => {
    // A flat-fee gym that is charged its flat fee on the web and a percentage
    // on WhatsApp is a gym billed differently depending on which door its
    // members happened to use. lib/renew-core.ts is shared by the web action
    // and /api/app/renew, so those two are one call site; WhatsApp is its own.
    for (const file of ['lib/renew-core.ts', 'lib/whatsapp/payments.ts']) {
      expect(read(file), `${file} must send the gym's commission with the charge`)
        .toMatch(/commission: gymCommission\(/);
    }
    // ...and the WhatsApp gym select has to actually fetch the columns it reads.
    const settings = read('lib/whatsapp/settings.ts');
    expect(settings).toContain('platform_commission_mode');
    expect(settings).toContain('platform_commission_fixed_amount');
  });

  // ...and initTransaction turns it into what Paystack is actually sent. The
  // body is asserted against a stubbed fetch rather than against the source:
  // which fields end up in that JSON is the thing that decides what a gym is
  // charged, and a regex over the file cannot see it.
  describe('and initTransaction turns it into a flat transaction_charge', () => {
    const realFetch = globalThis.fetch;
    const realKey = process.env.PAYSTACK_SECRET_KEY;

    afterEach(() => {
      globalThis.fetch = realFetch;
      if (realKey === undefined) delete process.env.PAYSTACK_SECRET_KEY;
      else process.env.PAYSTACK_SECRET_KEY = realKey;
    });

    /** Capture the body initTransaction would POST. No network: the stub never
     *  reaches one, and the endpoint is asserted so a redirect elsewhere fails
     *  rather than passing quietly. */
    async function sentBody(params: Parameters<typeof initTransaction>[0]) {
      process.env.PAYSTACK_SECRET_KEY = 'sk_test_not_a_real_key';
      let url = ''; let body: Record<string, unknown> = {};
      globalThis.fetch = (async (u: string, init: { body: string }) => {
        url = String(u); body = JSON.parse(init.body);
        return { ok: true, json: async () => ({ status: true, data: { authorization_url: 'https://x', reference: 'r' } }) };
      }) as unknown as typeof fetch;
      const res = await initTransaction(params);
      expect(res.ok, 'the stubbed call should succeed').toBe(true);
      expect(url).toContain('/transaction/initialize');
      return body;
    }

    const base = { email: 'm@example.com', amountKobo: 500_000, metadata: { plan_id: 'p1' } };

    it('sends the flat fee, in kobo, alongside the split', async () => {
      const body = await sentBody({ ...base, subaccount: 'ACCT_x1', commission: { mode: 'fixed', fixedNaira: 500 } });
      expect(body.transaction_charge).toBe(50_000);
      expect(body.subaccount).toBe('ACCT_x1');
    });

    it('records the flat fee on the charge’s own metadata', async () => {
      // The only field in the payload we control. Whether Paystack repeats
      // transaction_charge on the charge event is Paystack's choice, and
      // without our own record readSplit would call a flat charge a percentage
      // one at the subaccount's fallback rate — an arrangement the gym is not
      // on, unrecoverable after the fact. See lib/paystack-split.ts.
      const body = await sentBody({ ...base, subaccount: 'ACCT_x1', commission: { mode: 'fixed', fixedNaira: 500 } });
      expect(body.metadata).toEqual({ plan_id: 'p1', platform_commission_flat_kobo: 50_000 });
    });

    it('sends neither for a percentage gym, and leaves its metadata alone', async () => {
      const body = await sentBody({ ...base, subaccount: 'ACCT_x1', commission: { mode: 'percentage', fixedNaira: 0 } });
      expect(body).not.toHaveProperty('transaction_charge');
      expect(body.metadata).toEqual({ plan_id: 'p1' });
    });

    it('sends neither when there is no subaccount to route around', async () => {
      // With no split the whole amount already lands in the platform account,
      // so a flat charge has nothing to take a share away from.
      const body = await sentBody({ ...base, subaccount: null, commission: { mode: 'fixed', fixedNaira: 500 } });
      expect(body).not.toHaveProperty('transaction_charge');
      expect(body).not.toHaveProperty('subaccount');
      expect(body.metadata).toEqual({ plan_id: 'p1' });
    });
  });
});

describe('both places the rate is edited pass the split status', () => {
  it('the gyms table and the gym detail page', () => {
    for (const file of ['components/superadmin/gym-table.tsx', 'app/(superadmin)/superadmin/gyms/[id]/page.tsx']) {
      expect(read(file), `${file} must tell the editor whether a split exists`)
        .toMatch(/splitting=\{Boolean\(g(ym)?\.paystack_subaccount_code\)\}/);
    }
    // ...and the table has to actually select the column it passes.
    expect(read('components/superadmin/gym-table.tsx')).toContain('paystack_subaccount_code');
  });

  it('the detail page quotes what was recorded, not today’s rate times all history', () => {
    const src = read('app/(superadmin)/superadmin/gyms/[id]/page.tsx');
    expect(src).toContain('const splitLive = Boolean(gym.paystack_subaccount_code)');
    // The figure is a sum of recorded amounts...
    expect(src).toMatch(/commissionRows\.reduce\(/);
    expect(src).toContain('p.platform_commission_amount != null');
    // ...and the estimate survives only as an explicitly-labelled aside about
    // the rows that predate the recording.
    expect(src).toContain('an estimate only');
    expect(src).not.toMatch(/const commissionEarned = memberGmv \*/);
  });

  it('counts unrecorded payments rather than treating them as zero commission', () => {
    // NULL means "we didn't record it", and summing NULLs as zeroes would make
    // a gym that has always paid commission look like one that never has.
    const src = read('app/(superadmin)/superadmin/gyms/[id]/page.tsx');
    expect(src).toContain('p.platform_settlement == null');
    expect(src).toMatch(/unrecordedPays > 0/);
  });
});
