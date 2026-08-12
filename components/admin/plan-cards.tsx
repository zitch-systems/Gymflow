'use client';

import { useState, useTransition } from 'react';
import { Check } from 'lucide-react';
import { startPlatformSubscription } from '@/lib/actions/platform-billing';
import {
  PLATFORM_PLANS, PLAN_TIERS, BILLING_CYCLES, CYCLE_LABEL, CYCLE_SUFFIX,
  DEFAULT_CYCLE, planPrice, monthlyEquivalentKobo, cycleSavingPct,
  type PlanTier, type BillingCycle,
} from '@/lib/platform-plans';
import { fmtNaira } from '@/lib/format';

const FEATURES: Record<PlanTier, string[]> = {
  starter: ['Unlimited members', 'QR check-in', 'Paystack subscriptions', 'Email reminders'],
  growth: [
    'Everything in Starter', 'Class scheduling + waitlists', 'WhatsApp reminders',
    'Live analytics + exports', 'Multi-gym & staff roles', 'Instructor payouts', 'Priority support',
  ],
};

// Plan picker shared by the billing page (manage) and the access wall. Clicking
// a plan starts a Paystack subscription checkout and redirects to Paystack.
// GymFlow bills quarterly or annually — the toggle picks which Paystack Plan
// the checkout is opened against.
export function PlanCards({
  currentTier, currentCycle, highlightTier,
}: {
  currentTier?: PlanTier | null;
  currentCycle?: BillingCycle | null;
  highlightTier?: PlanTier;
}) {
  const [pending, startTransition] = useTransition();
  const [busyTier, setBusyTier] = useState<PlanTier | null>(null);
  const [cycle, setCycle] = useState<BillingCycle>(currentCycle ?? DEFAULT_CYCLE);
  const [error, setError] = useState<string | null>(null);

  function choose(tier: PlanTier) {
    setError(null);
    setBusyTier(tier);
    startTransition(async () => {
      const res = await startPlatformSubscription(tier, cycle);
      if (res.ok) {
        window.location.href = res.url;
      } else {
        setError(res.error);
        setBusyTier(null);
      }
    });
  }

  return (
    <>
      {error && (
        <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 10, background: 'var(--gf-danger-soft, #ff45601f)', color: 'var(--gf-danger, #ff4560)', fontSize: '0.86rem' }}>
          {error}
        </div>
      )}

      <div role="group" aria-label="Billing cycle" style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 18 }}>
        {BILLING_CYCLES.map((c) => {
          const on = c === cycle;
          // Savings differ per tier only if the discount ever diverges; quote the
          // top tier's so the badge reads as the best case, like the pricing page.
          const save = cycleSavingPct('growth', c);
          return (
            <button
              key={c}
              type="button"
              onClick={() => setCycle(c)}
              aria-pressed={on}
              className={`gf-btn gf-btn-${on ? 'primary' : 'ghost'} gf-btn-sm`}
            >
              {CYCLE_LABEL[c]}{save > 0 && <span style={{ marginLeft: 6, opacity: 0.85 }}>−{save}%</span>}
            </button>
          );
        })}
      </div>

      <div className="price-grid">
        {PLAN_TIERS.map((tier) => {
          const p = PLATFORM_PLANS[tier];
          const price = planPrice(tier, cycle);
          // "Current" means the tier AND the cycle they're on — an owner moving
          // from quarterly to annual needs that button to stay clickable.
          const isCurrent = currentTier === tier && currentCycle === cycle;
          const pop = highlightTier ? highlightTier === tier : tier === 'growth';
          const busy = pending && busyTier === tier;
          return (
            <div className={`price${pop ? ' pop' : ''}`} key={tier}>
              <div className="pname">{p.name}{isCurrent && <span className="pill" style={{ marginLeft: 8 }}>Current</span>}</div>
              <div className="amt">{fmtNaira(price.amountKobo / 100)}<small>{CYCLE_SUFFIX[cycle]}</small></div>
              <div style={{ color: 'var(--gf-text-muted)', fontSize: '0.85rem' }}>
                ≈{fmtNaira(monthlyEquivalentKobo(tier, cycle) / 100)}/mo · {p.tagline}
              </div>
              <ul>
                {FEATURES[tier].map((f) => <li key={f}><Check strokeWidth={2.2} /> {f}</li>)}
              </ul>
              <button
                type="button"
                onClick={() => choose(tier)}
                disabled={pending || isCurrent}
                className={`gf-btn gf-btn-${pop ? 'primary' : 'secondary'} gf-btn-full`}
                style={{ marginTop: 'auto' }}
              >
                {busy ? 'Redirecting…' : isCurrent ? 'Current plan' : `Choose ${p.name}`}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
