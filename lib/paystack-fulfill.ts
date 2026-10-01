import { createAdminClient } from '@/lib/supabase/admin';
import { settleMemberCharge } from '@/lib/member-charge';
import { logAudit } from '@/lib/audit';
import { deliverReceipt, type NotifyGym } from '@/lib/notify';
import { GYM_EMAIL_COLUMNS } from '@/lib/email/recipients';
import { captureServerEvent } from '@/lib/server-error';
import { settledAmountMatches } from '@/lib/paystack-event-state';
import { planTotalKobo, resolveTrainerOptIn } from '@/lib/plan-addon';
import type { SplitRecord } from '@/lib/paystack-split';

// `split` is what Paystack reported about the settlement — passed in rather
// than re-derived here, because the webhook and the post-checkout callback see
// it in different shapes (event body vs verify response) and only the caller
// knows which it holds. Null means the caller had nothing to say, which is
// recorded as "not recorded" rather than as zero commission.
export type ChargeData = { reference: string; amountKobo: number; currency: string; channel: string | null; metadata: Record<string, unknown>; split?: SplitRecord | null };
// `permanent` marks a failure that won't succeed on retry (e.g. unusable
// metadata) so the webhook can ack instead of asking Paystack to resend.
export type FulfillResult = { ok: boolean; created: boolean; error?: string; permanent?: boolean };

// Idempotently record a successful Paystack charge and extend the member's
// subscription. Shared by the webhook AND the post-checkout callback — and
// Paystack fires both near-simultaneously for the same transaction, so this
// MUST be race-safe. The database locks the reference and commits the payment
// and entitlement together. Duplicate requests can only see committed access.
// Requires the service-role key (payments / member_subscriptions are RLS-locked).
export async function fulfillCharge(d: ChargeData): Promise<FulfillResult> {
  const meta = d.metadata ?? {};
  const memberId = meta.member_id as string | undefined;
  const gymId = meta.gym_id as string | undefined;
  const planId = (meta.plan_id as string | undefined) ?? null;

  // Only the server-initialized one-off renewal flow belongs here. The webhook
  // signature proves Paystack sent the event; this stamp proves it is one of
  // the transaction shapes this fulfiller understands.
  if (meta.kind !== 'membership_renewal') {
    return { ok: false, created: false, error: 'unexpected charge kind', permanent: true };
  }
  if (!d.reference || typeof d.reference !== 'string' || d.reference.length > 200) {
    return { ok: false, created: false, error: 'missing/invalid reference', permanent: true };
  }
  if (d.currency !== 'NGN') return { ok: false, created: false, error: 'unexpected charge currency', permanent: true };
  if (!Number.isSafeInteger(d.amountKobo) || d.amountKobo <= 0) {
    return { ok: false, created: false, error: 'missing/invalid settled amount', permanent: true };
  }
  if (!settledAmountMatches(d.amountKobo, meta.expected_amount_kobo)) {
    return { ok: false, created: false, error: 'settled amount does not match checkout', permanent: true };
  }

  if (!memberId || !gymId || !planId) {
    return { ok: false, created: false, error: 'missing member_id/gym_id/plan_id in metadata', permanent: true };
  }

  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); } catch (e) { return { ok: false, created: false, error: (e as Error).message }; }

  // Do not let even a correctly signed but misclassified transaction attach a
  // payment to an unrelated tenant. A real renewal is initialized only after
  // requireMember() resolves this active link.
  const { data: memberLink, error: memberLinkErr } = await admin.from('gym_member_links')
    .select('id').eq('user_id', memberId).eq('gym_id', gymId).eq('is_active', true)
    .limit(1).maybeSingle();
  if (memberLinkErr) return { ok: false, created: false, error: memberLinkErr.message };
  if (!memberLink) return { ok: false, created: false, error: 'member is not active in gym', permanent: true };

  // The database checks tenant ownership and the server-owned checkout's
  // immutable amount/term. Current plan values are used only for legacy
  // validation and a price-drift audit; metadata cannot authorize access.
  let planPriceKobo: number | null = null;
  const { data: plan, error: planErr } = await admin.from('membership_plans')
    .select('duration_days, duration_months, price, trainer_addon_enabled, trainer_addon_price')
    .eq('id', planId).eq('gym_id', gymId).maybeSingle();
  if (planErr) return { ok: false, created: false, error: planErr.message };
  if (!plan) return { ok: false, created: false, error: 'plan does not belong to gym', permanent: true };

  const pm = Math.floor(Number(plan.duration_months ?? 0));
  const pd = plan.duration_days != null ? Math.floor(Number(plan.duration_days)) : 0;
  const planDays = Number.isFinite(pd) && pd > 0 ? Math.min(pd, 366) : null;
  const planMonths = planDays ? 0 : (Number.isFinite(pm) && pm > 0 ? Math.min(pm, 36) : 1);
  // The plan row is the authority on whether the add-on exists, so a metadata
  // flag alone can't award trainer time on a plan that never offered it.
  const trainerAddon = resolveTrainerOptIn(plan, meta.trainer_addon);
  // What this checkout SHOULD have cost, re-derived rather than taken from
  // metadata — the drift check below is only worth anything if the expectation
  // comes from the database.
  const pp = Number(plan.price ?? 0);
  if (Number.isFinite(pp) && pp > 0) planPriceKobo = planTotalKobo(plan, trainerAddon);

  const settled = await settleMemberCharge(admin, {
    reference: d.reference, gymId, memberId, planId, amountKobo: d.amountKobo,
    currency: d.currency, period: { duration_days: planDays, duration_months: planMonths },
    trainerAddon, method: d.channel ?? 'paystack', split: d.split,
  });
  if (!settled.ok) return { ok: false, created: false, error: settled.error };
  if (!settled.created) return { ok: true, created: false };
  const payRow = { id: settled.paymentId };
  const endIso = settled.endDate!;

  // The signed checkout snapshot already matched the settled charge. A
  // difference from the plan's CURRENT price therefore normally means staff
  // edited the price while checkout was open. Keep that drift observable
  // without rejecting a charge the member authorized. Legacy transactions
  // created before expected_amount_kobo shipped remain visible here too.
  if (planPriceKobo && planPriceKobo !== d.amountKobo) {
    void logAudit({
      action: 'payment_amount_mismatch',
      table: 'payments',
      gymId, recordId: memberId,
      values: {
        paystack_reference: d.reference,
        plan_id: planId,
        expected_kobo: planPriceKobo,
        received_kobo: d.amountKobo,
        delta_kobo: d.amountKobo - planPriceKobo,
      },
    });
    // A legacy transaction has no checkout snapshot to distinguish a genuine
    // price edit from underpayment. Page only that legacy case; new checkouts
    // have already failed closed above on any mismatch.
    if (meta.expected_amount_kobo == null && d.amountKobo < planPriceKobo) {
      void captureServerEvent('legacy member charge below current plan price', {
        paystack_reference: d.reference,
        gym_id: gymId,
        plan_id: planId,
        expected_kobo: planPriceKobo,
        received_kobo: d.amountKobo,
      });
    }
  }

  const { error: notifErr } = await admin.from('notifications').insert({
    gym_id: gymId, user_id: memberId, type: 'payment', channel: 'in_app',
    title: 'Payment received', body: `₦${(d.amountKobo / 100).toLocaleString('en-NG')} received — membership renewed.`,
    metadata: payRow ? { payment_id: payRow.id } : undefined,
  });
  if (notifErr) console.warn(`[fulfill] receipt notification failed for ${d.reference}: ${notifErr.message}`); // non-critical

  // Email receipt (respects the gym's payment-receipts toggle; inert without
  // RESEND_API_KEY). Best-effort like the in-app row — never fails fulfilment.
  // The key check comes first so a gym with email switched off doesn't pay for
  // two extra round-trips inside the webhook just to discover that.
  try {
    if (process.env.RESEND_API_KEY) {
      const [{ data: contact }, { data: gymRow }] = await Promise.all([
        admin.from('profiles').select('email, phone, full_name').eq('id', memberId).maybeSingle(),
        // GYM_EMAIL_COLUMNS, not the four columns the old plain-text mail needed:
        // the receipt now renders in the gym's own logo, colour and subdomain,
        // and a narrow select silently downgrades every member's receipt to
        // GymFlow branding with a link to the wrong host.
        admin.from('gyms').select(GYM_EMAIL_COLUMNS).eq('id', gymId).maybeSingle(),
      ]);
      if (contact && gymRow) {
        await deliverReceipt(
          gymRow as unknown as NotifyGym,
          { email: contact.email, phone: contact.phone, fullName: contact.full_name },
          { amountNaira: d.amountKobo / 100, endDate: endIso },
        );
      }
    }
  } catch { /* delivery is a bonus channel */ }
  return { ok: true, created: true };
}
