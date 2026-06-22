'use client';

import { useState, useTransition } from 'react';
import { Check } from 'lucide-react';
import { startPlatformSubscription } from '@/lib/actions/platform-billing';
import { PLATFORM_PLANS, PLAN_TIERS, type PlanTier } from '@/lib/platform-plans';
import { fmtNaira } from '@/lib/format';

const FEATURES: Record<PlanTier, string[]> = {
  starter: ['Unlimited members', 'QR check-in', 'Paystack subscriptions', 'Email reminders'],
  growth: ['Everything in Starter', 'Class scheduling + waitlists', 'WhatsApp reminders', 'Live analytics + exports'],
  scale: ['Everything in Growth', 'Multi-gym & staff roles', 'Instructor payouts', 'Priority support'],
};

// Plan picker shared by the billing page (manage) and the access wall. Clicking
// a plan starts a Paystack subscription checkout and redirects to Paystack.
export function PlanCards({ currentTier, highlightTier }: { currentTier?: PlanTier | null; highlightTier?: PlanTier }) {
  const [pending, startTransition] = useTransition();
  const [busyTier, setBusyTier] = useState<PlanTier | null>(null);
  const [error, setError] = useState<string | null>(null);

  function choose(tier: PlanTier) {
    setError(null);
    setBusyTier(tier);
    startTransition(async () => {
      const res = await startPlatformSubscription(tier);
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
      <div className="price-grid">
        {PLAN_TIERS.map((tier) => {
          const p = PLATFORM_PLANS[tier];
          const isCurrent = currentTier === tier;
          const pop = highlightTier ? highlightTier === tier : tier === 'growth';
          const busy = pending && busyTier === tier;
          return (
            <div className={`price${pop ? ' pop' : ''}`} key={tier}>
              <div className="pname">{p.name}{isCurrent && <span className="pill" style={{ marginLeft: 8 }}>Current</span>}</div>
              <div className="amt">{fmtNaira(p.amountKobo / 100)}<small>/mo</small></div>
              <div style={{ color: 'var(--gf-text-muted)', fontSize: '0.85rem' }}>{p.tagline}</div>
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
