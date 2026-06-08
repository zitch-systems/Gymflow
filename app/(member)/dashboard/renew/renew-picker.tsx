'use client';

import { useState, useTransition } from 'react';
import { CreditCard, Lock, AlertCircle } from 'lucide-react';
import { fmtNaira } from '@/lib/format';
import { startRenewal } from '@/lib/actions/renew';

export type Plan = { id: string; name: string; price: number; duration_months: number; description: string | null };

function periodSuffix(m: number): string {
  if (m <= 1) return '/mo'; if (m === 3) return '/qtr'; if (m === 12) return '/yr'; return `/${m}mo`;
}

// Plan picker — real plans from the server page. "Pay" starts a Paystack
// checkout (startRenewal → authorization_url); the renew callback + webhook
// record the payment and extend the subscription.
export function RenewPicker({ plans }: { plans: Plan[] }) {
  const [picked, setPicked] = useState(plans[0]?.id ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const sel = plans.find((p) => p.id === picked) ?? plans[0];

  function pay() {
    if (!sel) return;
    setErr(null);
    start(async () => {
      const res = await startRenewal(sel.id);
      if (res.ok) window.location.href = res.url; // → Paystack checkout
      else setErr(res.error);
    });
  }

  const perMonth = (p: Plan) => p.price / Math.max(1, p.duration_months);
  const baseline = plans.length ? Math.max(...plans.map(perMonth)) : 0;
  const cheapest = plans.length ? plans.reduce((b, p) => (perMonth(p) < perMonth(b) ? p : b), plans[0]).id : '';

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
      {err && <p style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--gf-danger)', fontSize: '0.84rem', margin: '12px 0 0' }}><AlertCircle size={15} strokeWidth={2} /> {err}</p>}
      <button className="gf-btn gf-btn-primary gf-btn-full gf-btn-lg" style={{ marginTop: 8 }} onClick={pay} disabled={!sel || pending}>
        <CreditCard strokeWidth={1.9} style={{ width: 18, height: 18 }} /> {pending ? 'Starting checkout…' : `Pay ${sel ? fmtNaira(sel.price) : ''} with Paystack`}
      </button>
      <div className="paysafe"><Lock strokeWidth={1.9} /> Secured by Paystack</div>
    </div>
  );
}
