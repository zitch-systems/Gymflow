'use server';

import { revalidatePath } from 'next/cache';
import { requirePlatformAdmin } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { logAudit } from '@/lib/audit';
import { updateSubaccountCommission } from '@/lib/paystack';
import { isPlanTier } from '@/lib/platform-plans';
import { parseCommission, type CommissionMode } from '@/lib/commission-settings';

export type CommissionState = {
  ok: boolean;
  error: string | null;
  message?: string;
  /** The percentage now stored, echoed back so the editor can show what stuck. */
  pct?: number;
  /** The mode now stored, echoed back for the same reason as `pct`. */
  mode?: CommissionMode;
  /** The flat naira per payment now stored. Only meaningful in fixed mode. */
  fixed?: number;
  /** True when the rate is only in our DB — no Paystack split is applying it. */
  notSplitting?: boolean;
};

// Set a gym's platform commission, platform-operator only. The cut is either a
// percentage of each member payment or a flat naira amount per payment; both
// are stored on the gym, and the mode says which one is live.
//
// Persists the setting and, when the gym already has a Paystack subaccount,
// pushes the PERCENTAGE live (the subaccount's percentage_charge is otherwise
// fixed at creation). It pushes that in fixed mode too — deliberately: the flat
// amount travels per-charge as transaction_charge, and the subaccount's
// percentage stays behind it as the fallback for any charge that arrives
// without one. See lib/paystack.ts initTransaction for why that direction is
// the safe one. Service-role client: a trusted superadmin write, gated by
// requirePlatformAdmin.
export async function setGymCommission(_prev: CommissionState, formData: FormData): Promise<CommissionState> {
  const gymId = String(formData.get('gymId') ?? '');
  if (!gymId) return { ok: false, error: 'Missing gym.' };
  // Both numbers and the mode are checked in one pure place — see
  // lib/commission-settings.ts parseCommission for what each rule is for.
  const parsed = parseCommission({
    mode: formData.get('mode'), pct: formData.get('pct'), fixed: formData.get('fixed'),
  });
  if (parsed.value === null) return { ok: false, error: parsed.error };
  const { mode, pct, fixed } = parsed.value;

  const admin = await requirePlatformAdmin();
  const db = createAdminClient();
  // Read the setting back rather than trusting the input: `.select()` on the
  // UPDATE returns the row as stored, so the editor can show the numbers that
  // are actually in the database. A save that silently didn't stick is the
  // failure this whole action is most likely to have, and the hardest to see.
  const { data: gym, error } = await db.from('gyms')
    .update({ platform_commission_pct: pct, platform_commission_mode: mode, platform_commission_fixed_amount: fixed })
    .eq('id', gymId)
    .select('platform_commission_pct, platform_commission_mode, platform_commission_fixed_amount, paystack_subaccount_code')
    .single();
  if (error) return { ok: false, error: error.message };
  if (!gym) return { ok: false, error: 'That gym no longer exists.' };

  const row = gym as {
    platform_commission_pct: number | string | null;
    platform_commission_mode: string | null;
    platform_commission_fixed_amount: number | string | null;
    paystack_subaccount_code: string | null;
  };
  const stored = Number(row.platform_commission_pct ?? pct);
  const storedMode: CommissionMode = row.platform_commission_mode === 'fixed' ? 'fixed' : 'percentage';
  const storedFixed = Number(row.platform_commission_fixed_amount ?? fixed);
  // What the operator just set, in the words the messages below use. In fixed
  // mode the percentage is stored but is not the arrangement, so quoting it
  // would describe the wrong deal.
  const label = storedMode === 'fixed' ? `₦${storedFixed.toLocaleString('en-NG')} per payment` : `${stored}%`;
  const subaccount = row.paystack_subaccount_code;

  // The row is written. Everything below is about the LIVE split, and none of it
  // may swallow the fact that the database changed — an earlier version returned
  // on a Paystack error before reaching these two lines, so the rate was saved,
  // the console kept rendering the old number, and the operator was told the
  // save had failed. Audit and revalidate first, report second.
  logAudit({
    action: 'gym_commission_updated', table: 'gyms', actorId: admin.id, gymId, recordId: gymId,
    // All three, not just the live one: the audit trail has to answer "what was
    // this gym's arrangement on that date", and in fixed mode the percentage is
    // still the Paystack fallback that a stray charge would settle on.
    values: { pct: stored, mode: storedMode, fixed: storedFixed },
  });
  revalidateGym(gymId);

  // No subaccount means no split exists to carry this rate: the gym has not
  // connected payouts, so member payments settle whole into the platform's own
  // Paystack account and nothing is divided at all. Saying "commission updated"
  // there would be a lie of omission — the number is stored and applying to
  // nothing.
  const echo = { pct: stored, mode: storedMode, fixed: storedFixed };

  if (!subaccount) {
    return {
      ok: true, error: null, ...echo, notSplitting: true,
      message: `Saved ${label} — but this gym hasn’t connected payouts, so no Paystack split is applying it yet.`,
    };
  }

  if (!process.env.PAYSTACK_SECRET_KEY) {
    return {
      ok: true, error: null, ...echo, notSplitting: true,
      message: `Saved ${label} — Paystack isn’t configured on this deployment, so the live split still carries the old rate.`,
    };
  }

  const r = await updateSubaccountCommission(subaccount, stored);
  if (!r.ok) {
    // Persisted, not just returned to this render — the reconciliation sweep
    // (lib/reconcile.ts reconcileGymSplits) finds this gym on its own from
    // here, without anyone re-opening the editor to reproduce the failure.
    await db.from('gyms').update({ paystack_sync_error: r.error, paystack_sync_checked_at: new Date().toISOString() } as never).eq('id', gymId);
    return {
      ok: false, error: `Saved ${label} in GymFlow, but Paystack rejected the split change: ${r.error}`,
      ...echo, notSplitting: true,
    };
  }

  // The push landed — clear any out-of-sync flag a previous attempt left, so
  // the sweep (and anything else that reads it later) doesn't act on stale news.
  await db.from('gyms').update({ paystack_sync_error: null, paystack_sync_checked_at: new Date().toISOString() } as never).eq('id', gymId);
  return {
    ok: true, error: null, ...echo,
    message: storedMode === 'fixed'
      // The flat fee rides on each charge, not on the subaccount — so what
      // "matches" here is the fallback percentage, and saying otherwise would
      // promise a live setting Paystack has no place to hold.
      ? `Commission updated to ${label}. It applies per payment; the ${stored}% split stays as the fallback.`
      : `Commission updated to ${label}. The live Paystack split now matches.`,
  };
}

// ── Shared plumbing for the per-gym platform controls ───────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function revalidateGym(gymId: string) {
  revalidatePath(`/superadmin/gyms/${gymId}`);
  revalidatePath('/superadmin/gyms');
  revalidatePath('/superadmin');
}

/** Every control below is a destructive cross-tenant write, so they all share
 *  the same front door: platform-admin gate, UUID-shaped id, service-role
 *  client. Returns the gym's name too — the audit entry and the success message
 *  should say which gym was changed, not just its id. */
async function openGym(gymId: string) {
  if (!UUID_RE.test(gymId)) return { error: 'Missing gym.' as string, admin: null, db: null, gym: null };
  const admin = await requirePlatformAdmin();
  const db = createAdminClient();
  const { data: gym } = await db.from('gyms')
    .select('id, name, status, subscription_status, subscription_plan, trial_ends_at')
    .eq('id', gymId).maybeSingle();
  if (!gym) return { error: 'That gym no longer exists.' as string, admin: null, db: null, gym: null };
  return { error: null, admin, db, gym };
}

// ── Suspend / reactivate ────────────────────────────────────────────────────

// gyms.status is the platform's own kill switch, separate from billing: it is
// what GymFlow sets when a gym must be taken offline for a reason the gym can't
// self-serve out of (abuse, a chargeback dispute, a legal request). Enforced in
// app/(admin)/layout.tsx and on the public landing page — the gym cannot
// subscribe its way past it, unlike the billing wall.
export async function setGymStatus(_prev: CommissionState, formData: FormData): Promise<CommissionState> {
  const gymId = String(formData.get('gymId') ?? '');
  const next = String(formData.get('status') ?? '');
  if (next !== 'active' && next !== 'suspended') return { ok: false, error: 'Unknown status.' };

  const { error, admin, db, gym } = await openGym(gymId);
  if (error) return { ok: false, error };

  const { error: writeErr } = await db!.from('gyms')
    .update({ status: next, updated_at: new Date().toISOString() })
    .eq('id', gymId);
  if (writeErr) return { ok: false, error: writeErr.message };

  logAudit({
    action: next === 'suspended' ? 'gym_suspended' : 'gym_reactivated',
    table: 'gyms', actorId: admin!.id, gymId, recordId: gymId,
    values: { name: gym!.name, from: gym!.status ?? null, to: next },
  });
  revalidateGym(gymId);
  return {
    ok: true, error: null,
    message: next === 'suspended'
      ? `${gym!.name} is suspended — its console and public page are offline.`
      : `${gym!.name} is live again.`,
  };
}

// ── Trial extension ─────────────────────────────────────────────────────────

const MAX_TRIAL_DAYS = 90;

// Extends the free trial by N days. Measured from whichever is later — now or
// the existing trial end — so extending an already-running trial adds days
// rather than truncating it, and extending a lapsed one gives the full N days.
export async function extendGymTrial(_prev: CommissionState, formData: FormData): Promise<CommissionState> {
  const gymId = String(formData.get('gymId') ?? '');
  const days = Number(formData.get('days'));
  if (!Number.isInteger(days) || days < 1 || days > MAX_TRIAL_DAYS) {
    return { ok: false, error: `Enter a whole number of days between 1 and ${MAX_TRIAL_DAYS}.` };
  }

  const { error, admin, db, gym } = await openGym(gymId);
  if (error) return { ok: false, error };

  const now = Date.now();
  const current = gym!.trial_ends_at ? new Date(gym!.trial_ends_at).getTime() : 0;
  const base = Math.max(now, Number.isFinite(current) ? current : 0);
  const until = new Date(base + days * 86_400_000).toISOString();

  // Back to 'trial' as well: a gym whose trial had lapsed is only unblocked
  // when gymBillingState() sees BOTH a future trial_ends_at and trial status.
  const patch = gym!.subscription_status === 'active'
    ? { trial_ends_at: until }
    : { trial_ends_at: until, subscription_status: 'trial' };

  const { error: writeErr } = await db!.from('gyms')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', gymId);
  if (writeErr) return { ok: false, error: writeErr.message };

  logAudit({
    action: 'gym_trial_extended', table: 'gyms', actorId: admin!.id, gymId, recordId: gymId,
    values: { name: gym!.name, days, from: gym!.trial_ends_at ?? null, to: until },
  });
  revalidateGym(gymId);
  return { ok: true, error: null, message: `Trial runs to ${until.slice(0, 10)}.` };
}

// ── Subscription override ───────────────────────────────────────────────────

const OVERRIDE_STATUSES = ['trial', 'active', 'past_due', 'cancelled'] as const;

// Manual override of the gym's GymFlow subscription. Two real needs: comping a
// gym onto a plan without a Paystack charge, and repairing a row after a webhook
// was missed. Deliberately does NOT touch Paystack — the codes on the gym row
// stay as they are, so a later webhook still reconciles against the real
// subscription rather than fighting whatever was typed here.
export async function setGymSubscription(_prev: CommissionState, formData: FormData): Promise<CommissionState> {
  const gymId = String(formData.get('gymId') ?? '');
  const plan = String(formData.get('plan') ?? '');
  const status = String(formData.get('status') ?? '');
  if (plan && !isPlanTier(plan)) return { ok: false, error: 'Unknown plan.' };
  if (!(OVERRIDE_STATUSES as readonly string[]).includes(status)) return { ok: false, error: 'Unknown subscription status.' };

  const { error, admin, db, gym } = await openGym(gymId);
  if (error) return { ok: false, error };

  // 'active' with no plan would count toward MRR at ₦0 and render as "—" on
  // every platform surface, so require the tier alongside it.
  if (status === 'active' && !plan) return { ok: false, error: 'Pick a plan to mark this gym active.' };

  const { error: writeErr } = await db!.from('gyms')
    .update({
      subscription_status: status,
      subscription_plan: plan || null,
      // Comped/repaired active gyms need a paid-through date or the layout gate
      // treats them as lapsed the moment the trial window passes.
      ...(status === 'active' && { subscription_current_period_end: new Date(Date.now() + 31 * 86_400_000).toISOString() }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', gymId);
  if (writeErr) return { ok: false, error: writeErr.message };

  logAudit({
    action: 'gym_subscription_overridden', table: 'gyms', actorId: admin!.id, gymId, recordId: gymId,
    values: {
      name: gym!.name,
      from: { plan: gym!.subscription_plan ?? null, status: gym!.subscription_status ?? null },
      to: { plan: plan || null, status },
    },
  });
  revalidateGym(gymId);
  return { ok: true, error: null, message: 'Subscription updated.' };
}
