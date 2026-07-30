'use server';

import { revalidatePath } from 'next/cache';
import { requirePlatformAdmin } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { logAudit } from '@/lib/audit';
import { updateSubaccountCommission } from '@/lib/paystack';
import { isPlanTier } from '@/lib/platform-plans';

export type CommissionState = { ok: boolean; error: string | null; message?: string };

// Set a gym's platform commission %, platform-operator only. Persists the new
// rate and, when the gym already has a Paystack subaccount, pushes it live (the
// subaccount's percentage_charge is otherwise fixed at creation). Service-role
// client: this is a trusted superadmin write, gated by requirePlatformAdmin.
export async function setGymCommission(_prev: CommissionState, formData: FormData): Promise<CommissionState> {
  const gymId = String(formData.get('gymId') ?? '');
  const pct = Number(formData.get('pct'));
  if (!gymId) return { ok: false, error: 'Missing gym.' };
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { ok: false, error: 'Enter a percentage between 0 and 100.' };

  const admin = await requirePlatformAdmin();
  const db = createAdminClient();
  const { data: gym, error } = await db.from('gyms')
    .update({ platform_commission_pct: pct })
    .eq('id', gymId)
    .select('paystack_subaccount_code')
    .single();
  if (error) return { ok: false, error: error.message };

  if (gym?.paystack_subaccount_code && process.env.PAYSTACK_SECRET_KEY) {
    const r = await updateSubaccountCommission(gym.paystack_subaccount_code, pct);
    if (!r.ok) return { ok: false, error: `Saved, but the live Paystack split wasn’t updated: ${r.error}` };
  }

  logAudit({ action: 'gym_commission_updated', table: 'gyms', actorId: admin.id, gymId, recordId: gymId, values: { pct } });
  revalidateGym(gymId);
  return { ok: true, error: null, message: 'Commission updated.' };
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
