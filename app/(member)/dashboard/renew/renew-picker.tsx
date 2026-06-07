'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CreditCard, Lock, Check } from 'lucide-react';
import { fmtNaira } from '@/lib/format';

export type Plan = { id: string; name: string; price: number; duration_months: number; description: string | null };

function periodSuffix(m: number): string {
  if (m <= 1) return '/mo'; if (m === 3) return '/qtr'; if (m === 12) return '/yr'; return `/${m}mo`;
}

// Plan picker — real plans passed from the server page. "Pay" is a placeholder
// success state until the Paystack flow is wired (needs SERVICE_ROLE_KEY).
export function RenewPicker({ plans }: { plans: Plan[] }) {
  const [picked, setPicked] = useState(plans[0]?.id ?? '');
  const [paid, setPaid] = useState(false);
  const sel = plans.find((p) => p.id === picked) ?? plans[0];

  const perMonth = (p: Plan) => p.price / Math.max(1, p.duration_months);
  const baseline = plans.length ? Math.max(...plans.map(perMonth)) : 0;
  const cheapest = plans.length ? plans.reduce((b, p) => (perMonth(p) < perMonth(b) ? p : b), plans[0]).id : '';

  if (paid) {
    return (
      <div className="ci-ok on">
        <div className="ring"><Check strokeWidth={2.4} /></div>
        <h2 style={{ fontFamily: 'var(--gf-font-display)', fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>Membership renewed!</h2>
        <p style={{ color: 'var(--gf-text-secondary)', margin: 0, textAlign: 'center' }}>Your {sel?.name} plan is active. A receipt is on its way to your email.</p>
        <Link href="/dashboard" className="gf-btn gf-btn-secondary">Back to home</Link>
      </div>
    );
  }

  return (
    <div>
      {plans.map((p) => {
        const save = baseline > 0 ? Math.round((1 - perMonth(p) / baseline) * 100) : 0;
        const badge = p.id === cheapest && plans.length > 1 ? { label: 'Best value', tone: 'accent' } : save >= 5 ? { label: `Save ${save}%`, tone: 'brand' } : null;
        return (
          <button key={p.id} type="button" className={`rplan${picked === p.id ? ' on' : ''}`} onClick={() => setPicked(p.id)} style={{ width: '100%', textAlign: 'left' }} aria-pressed={picked === p.id}>
            <span className="rk" aria-hidden />
            <div className="info">
              <strong>{p.name}{badge && <span className={`gf-badge gf-badge-${badge.tone}`} style={{ marginLeft: 4 }}>{badge.label}</span>}</strong>
              <small>{p.description ?? `Billed every ${p.duration_months} month${p.duration_months === 1 ? '' : 's'}`}</small>
            </div>
            <div className="pr">{fmtNaira(p.price)}<small>{periodSuffix(p.duration_months)}</small></div>
          </button>
        );
      })}
      <button className="gf-btn gf-btn-primary gf-btn-full gf-btn-lg" style={{ marginTop: 8 }} onClick={() => setPaid(true)} disabled={!sel}>
        <CreditCard strokeWidth={1.9} style={{ width: 18, height: 18 }} /> Pay {sel ? fmtNaira(sel.price) : ''} with Paystack
      </button>
      <div className="paysafe"><Lock strokeWidth={1.9} /> Secured by Paystack</div>
    </div>
  );
}
