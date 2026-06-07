'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CreditCard, Lock, Check } from 'lucide-react';

const PLANS = [
  { id: 'Monthly', amt: '₦13,999', per: '/mo', sub: 'Billed every month · cancel anytime' },
  { id: 'Quarterly', amt: '₦37,999', per: '/qtr', sub: 'Billed every 3 months', badge: { label: 'Save 10%', tone: 'brand' as const } },
  { id: 'Annual', amt: '₦119,999', per: '/yr', sub: 'Billed yearly · save 28%', badge: { label: 'Best value', tone: 'accent' as const } },
];

// Renew — recreates revamp/member.html "renew": plan picker (radio rows) +
// Paystack pay button → success state. No backend; pay() shows the success view.
export default function RenewPage() {
  const [picked, setPicked] = useState('Quarterly');
  const [paid, setPaid] = useState(false);
  const sel = PLANS.find((p) => p.id === picked)!;

  return (
    <section className="view on" data-v="renew">
      <div className="mhead" style={{ justifyContent: 'space-between', paddingBottom: 10 }}>
        <Link href="/dashboard/wallet" className="icon-btn" style={{ width: 34, height: 34 }} aria-label="Back to wallet">
          <ArrowLeft strokeWidth={1.9} />
        </Link>
        <strong className="htitle">Renew membership</strong>
        <span style={{ width: 34 }} />
      </div>

      {!paid ? (
        <div>
          <p style={{ color: 'var(--gf-text-secondary)', fontSize: '0.88rem', margin: '0 0 16px' }}>
            Your Annual plan renews in 137 days. Renew early to lock in your rate.
          </p>
          {PLANS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`rplan${picked === p.id ? ' on' : ''}`}
              onClick={() => setPicked(p.id)}
              style={{ width: '100%', textAlign: 'left' }}
              aria-pressed={picked === p.id}
            >
              <span className="rk" aria-hidden />
              <div className="info">
                <strong>
                  {p.id}
                  {p.badge && <span className={`gf-badge gf-badge-${p.badge.tone}`} style={{ marginLeft: 4 }}>{p.badge.label}</span>}
                </strong>
                <small>{p.sub}</small>
              </div>
              <div className="pr">{p.amt}<small>{p.per}</small></div>
            </button>
          ))}
          <button className="gf-btn gf-btn-primary gf-btn-full gf-btn-lg" style={{ marginTop: 8 }} onClick={() => setPaid(true)}>
            <CreditCard strokeWidth={1.9} style={{ width: 18, height: 18 }} /> Pay {sel.amt} with Paystack
          </button>
          <div className="paysafe"><Lock strokeWidth={1.9} /> Secured by Paystack · saved card •••• 4242</div>
        </div>
      ) : (
        <div className="ci-ok on">
          <div className="ring"><Check strokeWidth={2.4} /></div>
          <h2 style={{ fontFamily: 'var(--gf-font-display)', fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>Membership renewed!</h2>
          <p style={{ color: 'var(--gf-text-secondary)', margin: 0, textAlign: 'center' }}>
            Your <span>{picked}</span> plan is active. A receipt is on its way to your email.
          </p>
          <Link href="/dashboard" className="gf-btn gf-btn-secondary">Back to home</Link>
        </div>
      )}
    </section>
  );
}
