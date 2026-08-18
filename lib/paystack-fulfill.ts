import { createAdminClient } from '@/lib/supabase/admin';
import { extendDate, renewalBase } from '@/lib/plan-duration';
import { logAudit } from '@/lib/audit';
import { deliverReceipt, type NotifyGym } from '@/lib/notify';
import { GYM_EMAIL_COLUMNS } from '@/lib/email/recipients';
import { captureServerEvent } from '@/lib/server-error';
import { settledAmountMatches } from '@/lib/paystack-event-state';
import { planTotalKobo, resolveTrainerOptIn } from '@/lib/plan-addon';
import { commissionColumns, type SplitRecord } from '@/lib/paystack-split';

// `split` is what Paystack reported about the settlement — passed in rather
// than re-derived here, because the webhook and the post-checkout callback see
// it in different shapes (event body vs verify response) and only the caller
// knows which it holds. Null means the caller had nothing to say, which is
// recorded as "not recorded" rather than as zero commission.
export type ChargeData = { reference: string; amountKobo: number; channel: string | null; metadata: Record<string, unknown>; split?: SplitRecord | null };
// `permanent` marks a failure that won't succeed on retry (e.g. unusable
// metadata) so the webhook can ack instead of asking Paystack to resend.
export type FulfillResult = { ok: boolean; created: boolean; error?: string; permanent?: boolean };

// Idempotently record a successful Paystack charge and extend the member's
// subscription. Shared by the webhook AND the post-checkout callback — and
// Paystack fires both near-simultaneously for the same transaction, so this
// MUST be race-safe. Idempotency rests on a UNIQUE(paystack_reference) index
// (supabase/migrations/20260609_payments_paystack_reference_unique.sql): the
// pre-check is a fast path, the unique-violation catch is the real guard that
// stops a concurrent fulfiller from recording the payment / extending twice.
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
  if (!Number.isSafeInteger(d.amountKobo) || d.amountKobo <= 0) {
    return { ok: false, created: false, error: 'missing/invalid settled amount', permanent: true };
  }
  if (!settledAmountMatches(d.amountKobo, meta.expected_amount_kobo)) {
    return { ok: false, created: false, error: 'settled amount does not match checkout', permanent: true };
  }

  // Clamp to a sane whole-month range. In the normal flow duration_months is
  // server-set at init (renew.ts) from the plan, but this helper is keyed only
  // on metadata — clamp so a tampered/garbage value can't extend a sub by years.
  const monthsRaw = Math.floor(Number(meta.duration_months ?? 1));
  const months = Number.isFinite(monthsRaw) ? Math.min(Math.max(monthsRaw, 1), 36) : 1;
  // Daily/weekly plans carry duration_days (clamped) — it wins over months.
  const daysRaw = meta.duration_days != null ? Math.floor(Number(meta.duration_days)) : 0;
  const durationDays = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 366) : null;
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

  // Fast path: already recorded (the common case when the webhook wins the race
  // before the callback runs, or vice versa).
  const { data: existing } = await admin.from('payments').select('id').eq('paystack_reference', d.reference).maybeSingle();
  if (existing) return { ok: true, created: false };

  // Metadata carries the checkout snapshot, but the plan row is still the
  // authority for duration and tenant ownership. This prevents a malformed
  // event from turning a short plan into years of access. Price may legitimately
  // change after checkout; expected_amount_kobo above pins the settled amount
  // to what the member actually authorized at initialization.
  let planMonths = months;
  let planDays = durationDays;
  let planPriceKobo: number | null = null;
  const { data: plan, error: planErr } = await admin.from('membership_plans')
    .select('duration_days, duration_months, price, trainer_addon_enabled, trainer_addon_price')
    .eq('id', planId).eq('gym_id', gymId).maybeSingle();
  if (planErr) return { ok: false, created: false, error: planErr.message };
  if (!plan) return { ok: false, created: false, error: 'plan does not belong to gym', permanent: true };

  const pm = Math.floor(Number(plan.duration_months ?? 0));
  const pd = plan.duration_days != null ? Math.floor(Number(plan.duration_days)) : 0;
  planDays = Number.isFinite(pd) && pd > 0 ? Math.min(pd, 366) : null;
  planMonths = planDays ? 0 : (Number.isFinite(pm) && pm > 0 ? Math.min(pm, 36) : 1);
  // The plan row is the authority on whether the add-on exists, so a metadata
  // flag alone can't award trainer time on a plan that never offered it.
  const trainerAddon = resolveTrainerOptIn(plan, meta.trainer_addon);
  // What this checkout SHOULD have cost, re-derived rather than taken from
  // metadata — the drift check below is only worth anything if the expectation
  // comes from the database.
  const pp = Number(plan.price ?? 0);
  if (Number.isFinite(pp) && pp > 0) planPriceKobo = planTotalKobo(plan, trainerAddon);

  // Commission is stamped on the row at fulfilment because it is not
  // recoverable afterwards: the rate lives on the Paystack subaccount, an
  // operator can change it at any time, and Paystack keeps no per-charge
  // history we can read back. Without this the console could only ever
  // multiply TODAY's rate by all historical GMV — so editing a gym from 5% to
  // 10% silently repriced every payment it had ever taken.
  // `as never`: these columns postdate the generated database.types.ts, same
  // pattern as webhook_events in the webhook route.
  const { data: payRow, error: payErr } = await admin.from('payments').insert({
    member_id: memberId, gym_id: gymId, plan_id: planId,
    amount: d.amountKobo / 100, currency: 'NGN',
    status: 'success', payment_status: 'successful',
    payment_method: d.channel ?? 'paystack', paystack_reference: d.reference,
    payment_date: new Date().toISOString(),
    ...commissionColumns(d.split ?? null),
  } as never).select('id').single();
  if (payErr) {
    // 23505 = unique_violation: a concurrent fulfiller recorded this reference
    // between our pre-check and insert. Idempotent no-op, not a failure — and
    // crucially, we must NOT fall through to extend the subscription again.
    if (payErr.code === '23505') return { ok: true, created: false };
    return { ok: false, created: false, error: payErr.message };
  }

  // We are the writer that recorded the payment → extend (or create) the sub once.
  const { data: sub } = await admin.from('member_subscriptions')
    .select('id, end_date').eq('member_id', memberId).eq('gym_id', gymId).eq('status', 'active')
    .order('end_date', { ascending: false }).limit(1).maybeSingle();
  // Stack onto the current period when one is still running (buy = next period),
  // else start today. Shared rule — see renewalBase().
  const base = renewalBase(sub?.end_date);
  const newEnd = extendDate(base, { duration_days: planDays, duration_months: planMonths });
  const endIso = newEnd.toISOString().slice(0, 10);
  // trainer_addon tracks what the member paid for THIS period, so it's written
  // on every renewal — including back to false when they renew without the
  // trainer they took last time. Leaving a stale true would keep the gym owing
  // trainer time nobody paid for.
  const { error: subErr } = sub
    ? await admin.from('member_subscriptions').update({ end_date: endIso, plan_id: planId ?? undefined, trainer_addon: trainerAddon, updated_at: new Date().toISOString() }).eq('id', sub.id)
    : await admin.from('member_subscriptions').insert({ member_id: memberId, gym_id: gymId, plan_id: planId, status: 'active', trainer_addon: trainerAddon, start_date: new Date().toISOString().slice(0, 10), end_date: endIso });
  if (subErr) {
    // The member paid but the extension failed. The payment row we just
    // inserted is the idempotency lock — if we left it, every retry would
    // no-op at the pre-check and the member would stay unextended. Compensate:
    // remove the payment row and report failure so the webhook 500s and
    // Paystack retries the whole fulfillment.
    await admin.from('payments').delete().eq('paystack_reference', d.reference);
    return { ok: false, created: false, error: `subscription extend failed: ${subErr.message}` };
  }

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
