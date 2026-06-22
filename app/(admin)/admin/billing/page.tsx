import { Sparkles, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import { requireStaff } from '@/lib/auth/dal';
import { fmtDate } from '@/lib/format';
import { platformPlan } from '@/lib/platform-plans';
import { PlatformPlanPicker } from '@/components/admin/platform-plan-picker';

export const metadata = { title: 'Billing' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// The gym's OWN GymFlow subscription (flow ①). Shows current status + tier cards
// to subscribe / change plan via Paystack.
export default async function AdminBilling() {
  const { gym } = await requireStaff();
  const current = platformPlan(gym.subscription_plan);
  const periodEnd = gym.subscription_current_period_end;
  const trialEnds = gym.trial_ends_at;
  const onTrial = !periodEnd && !!trialEnds && new Date(trialEnds) > new Date();
  const active = gym.subscription_status === 'active' && !!periodEnd && new Date(periodEnd) > new Date();

  const banner = active
    ? { cls: 'gf-badge-success', icon: CheckCircle2, text: `${current?.name ?? 'GymFlow'} plan active — renews ${periodEnd ? fmtDate(periodEnd) : ''}` }
    : onTrial
      ? { cls: 'gf-badge-info', icon: Clock, text: `Free trial — ends ${trialEnds ? fmtDate(trialEnds) : ''}. Subscribe to keep your gym live.` }
      : { cls: 'gf-badge-warning', icon: AlertTriangle, text: 'No active GymFlow subscription. Choose a plan to keep your gym running.' };

  const Icon = banner.icon;

  return (
    <>
      <div className="page-h"><div><h1>Billing</h1><p>Your GymFlow subscription · {gym.name}</p></div></div>

      <div className="panel" style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span className="gf-kpi-icon" style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)' }}><Sparkles strokeWidth={1.9} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <strong style={{ fontFamily: 'var(--gf-font-display)', fontSize: '1.05rem' }}>{current?.name ?? 'No plan'}</strong>
              <span className={`gf-badge ${banner.cls}`}><Icon size={13} strokeWidth={2} /> {active ? 'Active' : onTrial ? 'Trial' : 'Inactive'}</span>
            </div>
            <div style={{ color: 'var(--gf-text-secondary)', fontSize: '0.88rem', marginTop: 2 }}>{banner.text}</div>
          </div>
        </div>
      </div>

      <PlatformPlanPicker currentTier={current?.tier ?? null} />

      <p style={{ color: 'var(--gf-text-muted)', fontSize: '0.82rem', marginTop: 16 }}>
        Billed monthly in Naira via Paystack. Changing plans starts a new checkout; your next renewal date updates once payment is confirmed.
      </p>
    </>
  );
}
