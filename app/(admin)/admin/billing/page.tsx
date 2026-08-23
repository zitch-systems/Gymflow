import { Check, Lock } from 'lucide-react';
import { requireStaff } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira } from '@/lib/format';
import {
  gymBillingState, PLATFORM_PLANS, isPlanTier, isBillingCycle, planPrice,
  CYCLE_LABEL, CYCLE_SUFFIX, type PlanTier, type BillingCycle,
} from '@/lib/platform-plans';
import { tierOf, tierHasFeature, requiredTier, type Feature } from '@/lib/entitlements';
import { PlanCards } from '@/components/admin/plan-cards';
import { CancelSubscription } from './cancel-subscription';

// Human labels for the entitlements panel — mirror the pricing page wording.
const FEATURE_LABELS: Record<Feature, string> = {
  qr_checkin: 'QR check-in',
  paystack_subscriptions: 'Paystack subscriptions',
  email_reminders: 'Email reminders',
  class_scheduling: 'Class scheduling + waitlists',
  whatsapp_reminders: 'WhatsApp reminders',
  ai_assistant: 'AI assistant',
  analytics_exports: 'Live analytics + exports',
  multi_gym: 'Multi-gym & staff roles',
  instructor_payouts: 'Instructor payouts',
  instructor_portal: 'Instructor portal',
  member_app: 'Member app',
  priority_support: 'Priority support',
};
const ALL_FEATURES = Object.keys(FEATURE_LABELS) as Feature[];

export const metadata = { title: 'Billing' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const OWNER_ROLES = new Set(['gym_owner', 'owner']);
// Nav hides this page from front desk (it's the gym's own GymFlow subscription
// cost, not member data), and the platform_payments RLS policy already scopes
// history rows to the owner + platform admins. Gate on the same finance roles
// the nav uses instead of the full admin-staff set, so front desk can't reach
// it via a direct URL either.
const FINANCE_ROLES = ['gym_owner', 'owner', 'manager', 'accountant'] as const;

function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  trial: { text: 'Free trial', color: '#4080ff' },
  active: { text: 'Active', color: '#11d18b' },
  past_due: { text: 'Payment failed', color: '#ffb020' },
  cancelling: { text: 'Cancelling', color: '#ffb020' },
  trial_expired: { text: 'Trial ended', color: '#ff4560' },
  cancelled: { text: 'Cancelled', color: '#ff4560' },
  suspended: { text: 'Suspended', color: '#ff4560' },
};

export default async function AdminBilling({ searchParams }: { searchParams: Promise<{ billing_error?: string; billing_cancelled?: string }> }) {
  const sp = await searchParams;
  const { gym, role } = await requireStaff(FINANCE_ROLES);
  const supabase = await createClient();
  const state = gymBillingState(gym);
  const isOwner = OWNER_ROLES.has(role);
  const currentTier: PlanTier | null = isPlanTier(gym.subscription_plan ?? '') ? (gym.subscription_plan as PlanTier) : null;
  // NULL for a gym that subscribed before cycles existed (still billing monthly
  // at Paystack). Left null rather than defaulted so the card shows "—" instead
  // of quoting a quarterly price the gym isn't actually paying.
  const currentCycle: BillingCycle | null = isBillingCycle(gym.subscription_billing_cycle ?? '') ? (gym.subscription_billing_cycle as BillingCycle) : null;
  const plan = currentTier ? PLATFORM_PLANS[currentTier] : null;
  const price = currentTier && currentCycle ? planPrice(currentTier, currentCycle) : null;

  const { data: history } = await supabase
    .from('platform_payments')
    .select('id, amount, plan, payment_status, paystack_reference, billing_period_start, billing_period_end, created_at')
    .eq('gym_id', gym.id)
    .order('created_at', { ascending: false })
    .limit(24);

  const badge = STATUS_LABEL[state] ?? STATUS_LABEL.trial;
  const renewLabel = state === 'trial' ? 'Trial ends' : state === 'cancelling' ? 'Access until' : state === 'active' ? 'Renews' : 'Period ends';
  const renewDate = state === 'trial' ? gym.trial_ends_at : gym.subscription_current_period_end ?? gym.trial_ends_at;

  return (
    <>
      <div className="hdr">
        <div>
          <span className="pill-plat">Platform</span>
          <h1>Billing</h1>
          <p>Your GymFlow subscription — what your gym pays to run on the platform.</p>
        </div>
      </div>

      {sp.billing_error && (
        <div style={{ padding: '12px 16px', borderRadius: 12, background: '#ff456016', border: '1px solid #ff456040', color: 'var(--gf-text)', marginBottom: 18 }}>
          <strong style={{ color: '#ff4560' }}>Couldn’t cancel:</strong> {sp.billing_error}
        </div>
      )}
      {sp.billing_cancelled && (
        <div style={{ padding: '12px 16px', borderRadius: 12, background: '#11d18b16', border: '1px solid #11d18b40', color: 'var(--gf-text)', marginBottom: 18 }}>
          <strong style={{ color: '#11d18b' }}>Subscription cancelled.</strong> You keep access until the current period ends.
        </div>
      )}

      {state === 'past_due' && (
        <div style={{ padding: '12px 16px', borderRadius: 12, background: '#ffb02016', border: '1px solid #ffb02040', color: 'var(--gf-text)', marginBottom: 18 }}>
          <strong style={{ color: '#ffb020' }}>Last payment failed.</strong> Paystack will retry automatically. Update your card on the
          next charge or re-subscribe below to avoid losing access.
        </div>
      )}

      <section className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-h"><div><h3>Current plan</h3><div className="sub">Status of your GymFlow subscription</div></div></div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28, padding: '4px 2px' }}>
          <div><div style={{ fontSize: '0.72rem', color: 'var(--gf-text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Plan</div><div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{plan?.name ?? '—'}</div></div>
          <div><div style={{ fontSize: '0.72rem', color: 'var(--gf-text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Status</div><div style={{ fontSize: '1.25rem', fontWeight: 700, color: badge.color }}>{badge.text}</div></div>
          <div><div style={{ fontSize: '0.72rem', color: 'var(--gf-text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Billing</div><div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{currentCycle ? CYCLE_LABEL[currentCycle] : '—'}</div></div>
          <div><div style={{ fontSize: '0.72rem', color: 'var(--gf-text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Price</div><div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{price && currentCycle ? <>{fmtNaira(Math.round(price.amountKobo / 100))}<small style={{ fontSize: '0.72rem', fontWeight: 500, color: 'var(--gf-text-muted)' }}>{CYCLE_SUFFIX[currentCycle]}</small></> : '—'}</div></div>
          <div><div style={{ fontSize: '0.72rem', color: 'var(--gf-text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{renewLabel}</div><div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{fmtDate(renewDate)}</div></div>
        </div>
        {isOwner && state === 'active' && <CancelSubscription />}
        {!isOwner && <p style={{ fontSize: '0.82rem', color: 'var(--gf-text-muted)', marginTop: 12 }}>Only the gym owner can change the GymFlow plan.</p>}
      </section>

      {/* What the current plan includes — informational (see lib/entitlements.ts,
          which mirrors the pricing page). Locked rows show the tier that unlocks
          them so owners know what an upgrade buys. */}
      <section className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-h"><div><h3>What’s included</h3><div className="sub">Features on your {PLATFORM_PLANS[tierOf(gym)].name} plan</div></div></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '10px 20px', padding: '4px 2px' }}>
          {ALL_FEATURES.map((f) => {
            const has = tierHasFeature(tierOf(gym), f);
            return (
              <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 9, opacity: has ? 1 : 0.55 }}>
                <span aria-hidden style={{ display: 'grid', placeItems: 'center', width: 22, height: 22, borderRadius: 7, flexShrink: 0, background: has ? 'var(--gf-brand-soft)' : 'var(--gf-elevated)', color: has ? 'var(--gf-brand)' : 'var(--gf-text-muted)' }}>
                  {has ? <Check size={13} strokeWidth={2.6} /> : <Lock size={12} strokeWidth={2.2} />}
                </span>
                <span style={{ fontSize: '0.88rem' }}>{FEATURE_LABELS[f]}</span>
                {!has && <span className="gf-badge gf-badge-neutral" style={{ marginLeft: 'auto', fontSize: '0.66rem', textTransform: 'capitalize' }}>{PLATFORM_PLANS[requiredTier(f)].name}</span>}
              </div>
            );
          })}
        </div>
      </section>

      {isOwner && (
        <section style={{ marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 12px' }}>{state === 'active' ? 'Change plan' : 'Choose a plan'}</h3>
          <PlanCards currentTier={currentTier} currentCycle={currentCycle} />
        </section>
      )}

      {/* Payment history is owner-only: the platform_payments RLS policy scopes
          rows to the gym owner (+ platform admins), so manager/accountant would
          always see a misleading "No charges yet" even when the gym has charges.
          Show the panel only to the role that can actually read it. */}
      {isOwner && (
        <section className="panel">
          <div className="panel-h"><div><h3>Payment history</h3><div className="sub">Your GymFlow charges</div></div></div>
          {history && history.length ? (
            <div className="tbl-scroll">
              <table className="tbl" style={{ width: '100%' }}>
                <thead><tr><th>Date</th><th>Plan</th><th>Period</th><th>Amount</th><th>Status</th></tr></thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td>{fmtDate(h.created_at)}</td>
                      <td style={{ textTransform: 'capitalize' }}>{h.plan ?? '—'}</td>
                      <td>{fmtDate(h.billing_period_start)} – {fmtDate(h.billing_period_end)}</td>
                      <td>{fmtNaira(Number(h.amount))}</td>
                      <td style={{ textTransform: 'capitalize' }}>{h.payment_status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty sm"><h3>No charges yet</h3><p>Your GymFlow payments appear here once your subscription starts.</p></div>
          )}
        </section>
      )}
    </>
  );
}
