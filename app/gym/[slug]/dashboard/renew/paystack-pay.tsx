'use client';

import { useState, useTransition } from 'react';
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

// Paystack v2 inline.js — loaded by next/script — exposes PaystackPop as a
// CONSTRUCTOR on window. Usage: `new window.PaystackPop().newTransaction({...})`.
// `newTransaction` lives on the instance, NOT on the constructor itself, so
// `window.PaystackPop.newTransaction(...)` (static call) throws
// "is not a function".
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
type PaystackPopInstance = { newTransaction: (opts: PaystackPopOptions) => void };
declare global {
  interface Window {
    PaystackPop?: new () => PaystackPopInstance;
  }
}

export function PaystackPayButton({ gymId, planId, amount, durationMonths, email, subaccount }: Props) {
  const [ready, setReady] = useState(() => typeof window !== 'undefined' && !!window.PaystackPop);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const publicKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY;

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
      const popup = new window.PaystackPop!();
      popup.newTransaction({
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
              plan_id: planId,
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
