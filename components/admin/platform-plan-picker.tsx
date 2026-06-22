'use client';

import { useState, useTransition } from 'react';
import { Check, AlertCircle } from 'lucide-react';
import { fmtNaira } from '@/lib/format';
import { startPlatformSubscription } from '@/lib/actions/billing';
import { PLATFORM_PLANS } from '@/lib/platform-plans';

// Tier cards for the gym's GymFlow subscription. "Subscribe" starts a Paystack
// checkout (startPlatformSubscription → authorization_url); the billing callback
// + webhook activate the subscription.
export function PlatformPlanPicker({ currentTier }: { currentTier: string | null }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [, start] = useTransition();

  function subscribe(tier: string) {
    setErr(null);
    setBusy(tier);
    start(async () => {
      const res = await startPlatformSubscription(tier);
      if (res.ok) window.location.href = res.url;
      else { setErr(res.error); setBusy(null); }
    });
  }

  return (
    <>
      {err && <p className="act-fb err" style={{ display: 'flex', alignItems: 'center', gap: 7 }}><AlertCircle size={15} strokeWidth={2} /> {err}</p>}
      <div className="plans">
        {PLATFORM_PLANS.map((p) => {
          const isCurrent = p.tier === currentTier;
          return (
            <div className={`plan${p.popular ? ' pop' : ''}`} key={p.tier}>
              <div className="plan-top">
                <span className="nm">{p.name}{p.popular && <span className="gf-badge gf-badge-brand" style={{ marginLeft: 6 }}>Popular</span>}</span>
                {isCurrent && <span className="gf-badge gf-badge-success">Current</span>}
              </div>
              <div className="amt">{fmtNaira(p.price)}<small>/mo</small></div>
              <div className="desc">{p.tagline}</div>
              <ul>{p.features.map((f, i) => <li key={i}><Check strokeWidth={2.2} /> {f}</li>)}</ul>
              <div className="acts">
                <button
                  type="button"
                  className={`gf-btn gf-btn-${p.popular ? 'primary' : 'secondary'} gf-btn-sm gf-btn-full`}
                  disabled={isCurrent || busy !== null}
                  onClick={() => subscribe(p.tier)}
                >
                  {isCurrent ? 'Current plan' : busy === p.tier ? 'Starting checkout…' : 'Subscribe'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
