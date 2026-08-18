import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

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
    expect(fn).toContain("select('platform_commission_pct, paystack_subaccount_code')");
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
    expect(fn).toMatch(/Saved \$\{stored\}% in GymFlow/);
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
