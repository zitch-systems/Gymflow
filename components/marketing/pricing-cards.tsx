'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';
import {
  PLATFORM_PLANS, PLAN_TIERS, BILLING_CYCLES, CYCLE_LABEL, CYCLE_SUFFIX,
  DEFAULT_CYCLE, planPrice, monthlyEquivalentKobo, cycleSavingPct,
  type PlanTier, type BillingCycle,
} from '@/lib/platform-plans';

// Public pricing cards with a billing-cycle toggle. A client component because
// the toggle is the whole point — but every price still comes from
// PLATFORM_PLANS (a pure module), so the cards, the page's JSON-LD Offers and
// the amount Paystack actually charges cannot drift apart.
//
// The page keeps the JSON-LD server-rendered: it enumerates all six tier ×
// cycle Offers, so search engines see the full catalogue regardless of which
// cycle a visitor happens to have toggled to.

const FEATURES: Record<PlanTier, string[]> = {
  starter: ['Gym admin portal', 'Unlimited members', 'QR check-in', 'Paystack subscriptions', 'Email reminders'],
  growth: [
    'Everything in Starter', 'Member app for your members', 'Instructor portal', 'WhatsApp + AI assistant',
    'Class scheduling + waitlists', 'Live analytics + exports', 'Multi-gym & staff roles', 'Instructor payouts', 'Priority support',
  ],
};

// Whole naira. monthlyEquivalentKobo divides a cycle price across its months, so
// ₦37,999/quarter lands on 1,266,633 kobo — rendering that raw puts a stray
// "₦12,666.33" on the card.
const naira = (kobo: number) => `₦${Math.round(kobo / 100).toLocaleString('en-NG')}`;

export function PricingCards() {
  const [cycle, setCycle] = useState<BillingCycle>(DEFAULT_CYCLE);

  return (
    <>
      <div className="price-cycle-wrap">
      <div className="cycle-toggle" role="group" aria-label="Billing cycle">
        {BILLING_CYCLES.map((c) => {
          // Savings vary by a point between tiers, so the tier-agnostic toggle
          // quotes the best case and each card states its own exact figure.
          const save = Math.max(...PLAN_TIERS.map((t) => cycleSavingPct(t, c)));
          const on = c === cycle;
          return (
            <button key={c} type="button" onClick={() => setCycle(c)} aria-pressed={on} className={on ? 'on' : undefined}>
              {CYCLE_LABEL[c]}
              {save > 0 && <span className="cycle-save">−{save}%</span>}
            </button>
          );
        })}
      </div>
      </div>

      <div className="price-grid">
        {PLAN_TIERS.map((tier) => {
          const plan = PLATFORM_PLANS[tier];
          const price = planPrice(tier, cycle);
          const save = cycleSavingPct(tier, cycle);
          const pop = tier === 'growth';
          return (
            <div className={`price${pop ? ' pop' : ''}`} key={tier}>
              <div className="pname">{plan.name}</div>
              <div className="amt">{naira(price.amountKobo)}<small>{CYCLE_SUFFIX[cycle]}</small></div>
              {/* Reserved whether or not it renders, so the two cards' feature
                  lists stay on the same baseline as the toggle changes. */}
              <div className="price-permo">
                {cycle !== DEFAULT_CYCLE && <>{naira(monthlyEquivalentKobo(tier, cycle))}/mo · save {save}%</>}
              </div>
              <p className="price-tag">{plan.tagline}</p>
              <ul>
                {FEATURES[tier].map((f) => <li key={f}><Check strokeWidth={2.2} /> {f}</li>)}
              </ul>
              <Link href="/signup" className={`gf-btn gf-btn-${pop ? 'primary' : 'secondary'} gf-btn-full`} style={{ marginTop: 'auto' }}>
                Choose {plan.name}
              </Link>
            </div>
          );
        })}
      </div>
    </>
  );
}
