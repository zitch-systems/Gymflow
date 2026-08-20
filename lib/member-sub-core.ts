import type { SupabaseClient } from '@supabase/supabase-js';
import { extendDate, renewalBase, type PlanDuration } from '@/lib/plan-duration';

// The shared rules for a member's subscription row: which statuses count as
// live, whether a standing card mandate already exists, and the ONE way to add
// a paid period to a subscription. Deliberately NOT 'server-only' so the vitest
// suite can exercise the pure rules without a database — same posture as
// lib/reconcile-core.ts.

/* eslint-disable @typescript-eslint/no-explicit-any */
// See lib/checkin-core.ts for why the client type is loose here: three callers
// pass three differently-typed clients (two service-role, one RLS-scoped).
type Sb = SupabaseClient<any, any, any>;

/** `as never` on an rpc NAME collapses the whole builder to `never`, so a
 *  function that postdates the generated types goes through this narrow
 *  wrapper instead (same trick as app/g/[slug]/page.tsx). */
type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
};

// The statuses that mean "this row IS the member's current membership": access
// running (active), lapsing (past_due) or frozen (paused / pause_requested).
// A member holds at most one of these per gym — enforced by
// member_subscriptions_one_live_idx (20260821093000_one_live_member_sub.sql) —
// so this is also the set a writer that lost the INSERT race re-reads before
// extending. Keep in step with the index's WHERE clause.
export const LIVE_SUB_STATUSES = ['active', 'past_due', 'paused', 'pause_requested'] as const;

export type MandateRow = { auto_debit_enabled?: boolean | null };

/**
 * Does this member already have a standing card mandate at Paystack?
 *
 * Only auto_debit_enabled answers that, NOT the presence of a cached
 * paystack_subscription_code: cancelling auto-renew (disableSub, and the
 * subscription.disable webhook) clears the flag and deliberately leaves the
 * code behind, so a member who turned auto-renew off would otherwise be
 * permanently barred from turning it back on. The flag is also exactly what
 * lib/member-sub-fulfill.ts tests before refusing a charge from a second
 * mandate, so gating the opt-in on it means the fulfiller never meets one.
 */
export function hasLiveMandate(subs: MandateRow[] | null | undefined): boolean {
  return (subs ?? []).some((s) => s.auto_debit_enabled === true);
}

// `code` is the SQLSTATE behind a failure when there was one, so a caller can
// tell "the one-live index refused this row" (23505) from every other reason an
// extension can fail. lib/member-sub-fulfill.ts is the one that has to: it
// extends a row it resolved by Paystack subscription code, which is not
// necessarily the member's live row any more.
/**
 * Paystack refused to disable (or even describe) a mandate. Is that mandate
 * gone at Paystack anyway?
 *
 * A 4xx says Paystack has nothing it will act on under this subscription code —
 * no such subscription, one that is already inactive, or a token we can no
 * longer produce. The card is not being billed on our behalf any more, so the
 * local auto_debit_enabled flag is simply stale and clearing it is the honest
 * write. 5xx and network failures are the opposite case: Paystack may well
 * still be billing, so those must keep failing loudly rather than switching the
 * app's copy of the truth.
 *
 * Why this matters beyond one button: auto_debit_enabled is also what the
 * opt-in guard reads (hasLiveMandate above). Without this, a member whose flag
 * is stuck true against a mandate Paystack has already dropped can neither turn
 * auto-renew off (the disable call can never succeed) nor turn it back on (the
 * guard sees a live mandate) — a permanent dead end with no self-serve way out.
 */
export function mandateGoneAtPaystack(res: { status?: number }): boolean {
  return typeof res.status === 'number' && res.status >= 400 && res.status < 500;
}

export type ExtendResult = { ok: true; endDate: string } | { ok: false; error: string; code?: string };

/**
 * Stack one billing period onto an existing subscription. Returns the new end
 * date as YYYY-MM-DD.
 *
 * The arithmetic lives in SQL (extend_member_sub, see
 * 20260821090000_atomic_member_sub_extend.sql) rather than here, and that is
 * the whole point: three writers used to read end_date, add the period in
 * JavaScript and write the result back, so two payments settling at the same
 * instant both read the same date, both computed the same one, and the second
 * write dropped a period the member had paid for. The RPC derives the new date
 * from the row inside the UPDATE, which Postgres re-evaluates against the
 * winning version of a concurrently-written row.
 *
 * `planId` / `trainerAddon` are optional; null leaves what the row already has.
 */
export async function extendMemberSub(
  sb: Sb,
  subId: string,
  period: PlanDuration,
  fields: { planId?: string | null; trainerAddon?: boolean | null } = {},
): Promise<ExtendResult> {
  const { data, error } = await (sb as unknown as RpcClient).rpc('extend_member_sub', {
    p_id: subId,
    p_days: period.duration_days ?? null,
    p_months: period.duration_months ?? null,
    p_plan_id: fields.planId ?? null,
    p_trainer_addon: fields.trainerAddon ?? null,
  });
  if (error) return { ok: false, error: error.message, code: error.code };
  // The function returns the updated row's end_date, so no date back means no
  // row was updated — a stale id, or RLS refusing this caller. Either way the
  // member was NOT extended and the caller must not report that they were.
  if (typeof data !== 'string') return { ok: false, error: 'subscription not found' };
  return { ok: true, endDate: data };
}

/**
 * Give the member one more billing period, creating their subscription if this
 * is the first one. Returns the new end date as YYYY-MM-DD.
 *
 * Both branches used to be racy: concurrent fulfillers either overwrote each
 * other's end_date (extendMemberSub covers that) or both concluded "no
 * subscription" and both inserted, leaving two live rows, two mirrored
 * memberships and one period of access for two payments. The unique index now
 * refuses the second insert, and the 23505 below is that refusal being handled
 * the way the losing writer should have behaved all along: re-read the row that
 * won and stack onto it.
 */
export async function grantMemberPeriod(
  sb: Sb,
  who: { gymId: string; memberId: string },
  period: PlanDuration,
  fields: { planId?: string | null; trainerAddon?: boolean | null } = {},
): Promise<ExtendResult> {
  // Latest ACTIVE sub only: a later-dated cancelled/expired row must not be
  // picked up and silently reactivated.
  const { data: sub } = await sb.from('member_subscriptions')
    .select('id').eq('member_id', who.memberId).eq('gym_id', who.gymId).eq('status', 'active')
    .order('end_date', { ascending: false }).limit(1).maybeSingle();
  if (sub) return extendMemberSub(sb, sub.id, period, fields);

  // Nothing live to stack onto — start the period today. renewalBase(null) is
  // today, so this is the same rule the RPC applies with nothing to stack on.
  const today = new Date();
  const endIso = extendDate(renewalBase(null, today), period).toISOString().slice(0, 10);
  const { error } = await sb.from('member_subscriptions').insert({
    gym_id: who.gymId, member_id: who.memberId, plan_id: fields.planId ?? null,
    status: 'active', trainer_addon: fields.trainerAddon ?? false,
    start_date: today.toISOString().slice(0, 10), end_date: endIso,
  });
  if (!error) return { ok: true, endDate: endIso };
  if (error.code !== '23505') return { ok: false, error: error.message };

  // member_subscriptions_one_live_idx rejected us: another writer created the
  // member's live row between the read above and this insert. Extend theirs.
  const { data: live } = await sb.from('member_subscriptions')
    .select('id').eq('member_id', who.memberId).eq('gym_id', who.gymId)
    .in('status', [...LIVE_SUB_STATUSES])
    .order('end_date', { ascending: false }).limit(1).maybeSingle();
  if (!live) return { ok: false, error: error.message };
  return extendMemberSub(sb, live.id, period, fields);
}
