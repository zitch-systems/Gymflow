'use client';

import { useState } from 'react';
import { Lock } from 'lucide-react';
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

  const badgeFor = (p: Plan): { label: string; tone: 'brand' | 'accent' } | null => {
    if (plans.length > 1 && p.id === bestId) return { label: 'Best value', tone: 'accent' };
    const save = Math.round((1 - perMonth(p) / baseline) * 100);
    return save >= 5 ? { label: `Save ${save}%`, tone: 'brand' } : null;
  };

  // Per-period suffix the prototype uses (/mo, /qtr, /yr).
  const periodSuffix = (months: number): string => {
    if (months <= 1) return '/mo';
    if (months === 3) return '/qtr';
    if (months === 12) return '/yr';
    return `/${months}mo`;
  };

  // Short tagline shown under the plan name — prefer the gym's own description,
  // fall back to a per-cadence stock line so the layout doesn't collapse.
  const tagline = (p: Plan): string => {
    if (p.description) return p.description;
    if (p.duration_months <= 1) return 'Billed every month · cancel anytime';
    if (p.duration_months === 3) return 'Billed every 3 months';
    if (p.duration_months === 12) return 'Billed yearly';
    return `Billed every ${p.duration_months} months`;
  };

  const [selectedId, setSelectedId] = useState(bestId);
  const selected = plans.find((p) => p.id === selectedId) ?? plans[0];

  return (
    <div role="radiogroup" aria-label="Membership plans">
      {plans.map((p) => {
        const isSel = p.id === selected.id;
        const badge = badgeFor(p);
        return (
          <button
            type="button"
            key={p.id}
            role="radio"
            aria-checked={isSel}
            className={`rplan${isSel ? ' on' : ''}`}
            onClick={() => setSelectedId(p.id)}
          >
            <span className="rk" aria-hidden />
            <div className="info">
              <strong>
                {p.name}
                {badge && (
                  <span className={`gf-badge gf-badge-${badge.tone}`} style={{ marginLeft: 4 }}>
                    {badge.label}
                  </span>
                )}
              </strong>
              <small>{tagline(p)}</small>
            </div>
            <div className="pr">
              {fmtNaira(p.price)}
              <small>{periodSuffix(p.duration_months)}</small>
            </div>
          </button>
        );
      })}

      <div style={{ marginTop: 8 }}>
        <PaystackPayButton
          gymId={gymId}
          planId={selected.id}
          amount={selected.price}
          durationMonths={selected.duration_months}
          email={email}
          subaccount={subaccount}
        />
      </div>
      <div className="paysafe">
        <Lock aria-hidden /> Secured by Paystack · cancel anytime
      </div>
    </div>
  );
}
