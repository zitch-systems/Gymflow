'use client';

import { useState } from 'react';
import { Check, Lock } from 'lucide-react';
import { fmtNaira } from '@/lib/format';
import { PaystackPayButton } from './paystack-pay';

type Plan = {
  id: string;
  name: string;
  duration_months: number;
  price: number;
  description: string | null;
};

// Radio-style plan picker (matches revamp/member.html "renew"): pick one plan,
// then a single Paystack button for the selection. The payment component is
// reused untouched — only the selection UI is new.
export function RenewPlanPicker({
  plans,
  gymId,
  email,
  subaccount,
}: {
  plans: Plan[];
  gymId: string;
  email: string;
  subaccount?: string | null;
}) {
  const perMonth = (p: Plan) => p.price / Math.max(1, p.duration_months);
  // Baseline = priciest per-month plan (usually the 1-month) — savings are measured against it.
  const baseline = Math.max(...plans.map(perMonth));
  const bestId = plans.reduce((best, p) => (perMonth(p) < perMonth(best) ? p : best), plans[0]).id;

  const badgeFor = (p: Plan): string | null => {
    if (plans.length > 1 && p.id === bestId) return 'Best value';
    const save = Math.round((1 - perMonth(p) / baseline) * 100);
    return save >= 5 ? `Save ${save}%` : null;
  };

  const [selectedId, setSelectedId] = useState(bestId);
  const selected = plans.find((p) => p.id === selectedId) ?? plans[0];

  return (
    <div className="m-renew">
      <div className="m-renew-plans" role="radiogroup" aria-label="Membership plans">
        {plans.map((p) => {
          const isSel = p.id === selected.id;
          const badge = badgeFor(p);
          return (
            <button
              type="button"
              key={p.id}
              role="radio"
              aria-checked={isSel}
              className={`m-rplan${isSel ? ' on' : ''}`}
              onClick={() => setSelectedId(p.id)}
            >
              <span className="m-rplan-radio" aria-hidden>{isSel ? <Check size={14} strokeWidth={3} /> : null}</span>
              <span className="m-rplan-main">
                <span className="m-rplan-name">
                  {p.name}
                  {badge && <span className="m-rplan-badge">{badge}</span>}
                </span>
                <span className="m-rplan-meta">
                  {p.duration_months} month{p.duration_months === 1 ? '' : 's'} · {fmtNaira(perMonth(p))}/mo
                </span>
              </span>
              <span className="m-rplan-price">{fmtNaira(p.price)}</span>
            </button>
          );
        })}
      </div>

      <div className="m-renew-pay">
        <div className="m-renew-total">
          <span>Total today</span>
          <strong>{fmtNaira(selected.price)}</strong>
        </div>
        <PaystackPayButton
          gymId={gymId}
          planId={selected.id}
          amount={selected.price}
          durationMonths={selected.duration_months}
          email={email}
          subaccount={subaccount}
        />
        <p className="m-renew-secure"><Lock size={13} strokeWidth={2} aria-hidden /> Secured by Paystack · cancel anytime</p>
      </div>
    </div>
  );
}
