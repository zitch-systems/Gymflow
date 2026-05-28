'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import { useToast } from '@/lib/toast';

// window.PaystackPop is declared globally by the renew flow's paystack-pay
// component — reuse that ambient typing rather than redeclaring with a
// narrower shape (TS would complain about diverging Window augmentation).

type Props = {
  gymId: string;
  email: string;
  amountNaira: number;
  label: string;
};

export function BillingPayButton({ gymId, email, amountNaira, label }: Props) {
  const [ready, setReady] = useState(() => typeof window !== 'undefined' && !!window.PaystackPop);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const publicKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY;

  if (!publicKey) {
    return <button type="button" className="gf-btn gf-btn-outline" disabled>Payment not configured</button>;
  }
  if (!email) {
    return <button type="button" className="gf-btn gf-btn-outline" disabled>Missing owner email</button>;
  }

  const handleClick = () => {
    if (!window.PaystackPop) {
      toast('Payment library still loading — try again', 'warning');
      return;
    }
    start(() => {
      const ref = 'GFP-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      window.PaystackPop!.newTransaction({
        key: publicKey,
        email,
        amount: Math.round(amountNaira * 100),
        currency: 'NGN',
        ref,
        metadata: { purpose: 'platform_renew_now', gym_id: gymId },
        onSuccess: (txn) => {
          fetch('/api/platform/renew-now', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reference: txn.reference, gym_id: gymId }),
          })
            .then((r) => r.json())
            .then((data) => {
              if (data.success) {
                toast('Subscription renewed', 'success');
                router.refresh();
              } else {
                toast(data.error ?? 'Renewal failed', 'error');
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
      <button
        type="button"
        className="gf-btn gf-btn-primary"
        onClick={handleClick}
        disabled={!ready || pending}
      >
        {pending ? 'Processing…' : ready ? label : 'Loading…'}
      </button>
    </>
  );
}
