'use client';

import { useEffect, useState, useTransition } from 'react';
import Script from 'next/script';
import { useRouter } from 'next/navigation';
import { useToast } from '@/lib/toast';

type Props = {
  gymId: string;
  planId: string;
  amount: number;
  durationMonths: number;
  email: string;
  subaccount?: string | null;
};

// Loaded by next/script — populates window.PaystackPop.
type PaystackPopOptions = {
  key: string;
  email: string;
  amount: number;
  currency: string;
  ref: string;
  metadata: Record<string, unknown>;
  subaccount?: string;
  bearer?: 'account' | 'subaccount';
  onSuccess: (txn: { reference: string }) => void;
  onClose: () => void;
};
declare global {
  interface Window {
    PaystackPop?: {
      newTransaction: (opts: PaystackPopOptions) => void;
    };
  }
}

function computeEndDate(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split('T')[0];
}

export function PaystackPayButton({ gymId, planId, amount, durationMonths, email, subaccount }: Props) {
  const [ready, setReady] = useState(false);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const publicKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY;

  useEffect(() => {
    if (typeof window !== 'undefined' && window.PaystackPop) setReady(true);
  }, []);

  if (!publicKey) {
    return (
      <button type="button" className="gf-btn gf-btn-outline gf-btn-full" disabled>
        Payment not configured
      </button>
    );
  }
  if (!email) {
    return (
      <button type="button" className="gf-btn gf-btn-outline gf-btn-full" disabled>
        Missing email
      </button>
    );
  }

  const handleClick = () => {
    if (!window.PaystackPop) {
      toast('Payment library still loading — try again in a moment.', 'warning');
      return;
    }
    start(() => {
      const ref = 'GF-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      window.PaystackPop!.newTransaction({
        key: publicKey,
        email,
        amount: Math.round(amount * 100),
        currency: 'NGN',
        ref,
        metadata: { gym_id: gymId, plan_id: planId, duration_months: durationMonths },
        ...(subaccount ? { subaccount, bearer: 'subaccount' as const } : {}),
        onSuccess: (txn) => {
          fetch('/api/paystack/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              reference: txn.reference,
              gym_id: gymId,
              plan_id: planId,
              amount,
              end_date: computeEndDate(durationMonths),
            }),
          })
            .then((r) => r.json())
            .then((data) => {
              if (data.success) {
                toast('Membership renewed!', 'success');
                router.push('/dashboard');
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
      <button
        type="button"
        className="gf-btn gf-btn-primary gf-btn-full"
        onClick={handleClick}
        disabled={!ready || pending}
      >
        {pending ? 'Processing…' : ready ? 'Pay with Paystack' : 'Loading…'}
      </button>
    </>
  );
}
