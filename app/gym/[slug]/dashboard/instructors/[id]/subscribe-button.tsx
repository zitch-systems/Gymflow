'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import { useToast } from '@/lib/toast';

type Props = {
  gymId: string;
  instructorId: string;
  instructorName: string;
  email: string;
  priceMonthly: number;
  subaccount: string | null;
};

export function SubscribeButton({ gymId, instructorId, instructorName, email, priceMonthly, subaccount }: Props) {
  const [ready, setReady] = useState(() => typeof window !== 'undefined' && !!window.PaystackPop);
  const [months, setMonths] = useState(1);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const publicKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY;

  if (!publicKey) {
    return <button type="button" className="gf-btn gf-btn-outline gf-btn-full" disabled>Payment not configured</button>;
  }

  const amount = priceMonthly * months;

  const handleClick = () => {
    if (!window.PaystackPop) {
      toast('Payment library still loading — try again', 'warning');
      return;
    }
    start(() => {
      const ref = 'GFI-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      window.PaystackPop!.newTransaction({
        key: publicKey,
        email,
        amount: Math.round(amount * 100),
        currency: 'NGN',
        ref,
        metadata: { gym_id: gymId, instructor_id: instructorId, months },
        ...(subaccount ? { subaccount, bearer: 'subaccount' as const } : {}),
        onSuccess: (txn) => {
          fetch('/api/paystack/verify-instructor', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              reference: txn.reference,
              gym_id: gymId,
              instructor_id: instructorId,
              months,
            }),
          })
            .then((r) => r.json())
            .then((data) => {
              if (data.success) {
                toast(`Subscribed to ${instructorName}!`, 'success');
                router.refresh();
              } else {
                toast(data.error ?? 'Verification failed', 'error');
              }
            })
            .catch((err: Error) => toast(err.message, 'error'));
        },
        onClose: () => toast('Payment closed', 'info'),
      });
    });
  };

  return (
    <>
      <Script
        src="https://js.paystack.co/v2/inline.js"
        strategy="afterInteractive"
        onLoad={() => setReady(true)}
      />
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <div className="gf-form-group">
          <label className="gf-label" htmlFor="months">Months</label>
          <select id="months" value={months} onChange={(e) => setMonths(Number(e.target.value))} className="gf-input">
            {[1, 3, 6, 12].map((m) => (
              <option key={m} value={m}>{m} month{m === 1 ? '' : 's'}</option>
            ))}
          </select>
        </div>
        <div className="gf-form-group">
          <label className="gf-label">Total</label>
          <div style={{ padding: '10px 12px', background: 'var(--gf-elevated)', borderRadius: 8, fontWeight: 600 }}>
            ₦{amount.toLocaleString('en-NG')}
          </div>
        </div>
      </div>
      <button
        type="button"
        className="gf-btn gf-btn-primary gf-btn-full gf-btn-lg"
        onClick={handleClick}
        disabled={!ready || pending}
      >
        {pending ? 'Processing…' : ready ? `Subscribe — ₦${amount.toLocaleString('en-NG')}` : 'Loading…'}
      </button>
    </>
  );
}
