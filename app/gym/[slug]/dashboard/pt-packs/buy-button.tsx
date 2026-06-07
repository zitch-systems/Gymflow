'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import { useToast } from '@/lib/toast';

type Props = {
  packId: string;
  packName: string;
  amount: number;
  email: string;
  subaccount: string | null;
};

// Member-facing inline checkout for a PT pack. Mirrors the existing
// instructor-subscription button: load Paystack inline, open the modal with
// a server-derived amount + a metadata.purpose=pt_pack tag, then POST the
// reference to /api/paystack/verify-pt-pack on success.
export function PtPackBuyButton({ packId, packName, amount, email, subaccount }: Props) {
  const [ready, setReady] = useState(() => typeof window !== 'undefined' && !!window.PaystackPop);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const publicKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY;

  if (!publicKey) {
    return <button type="button" className="gf-btn gf-btn-outline gf-btn-sm" disabled>Payment not configured</button>;
  }
  if (!email) {
    return <button type="button" className="gf-btn gf-btn-outline gf-btn-sm" disabled>Sign in first</button>;
  }

  const handleClick = () => {
    if (!window.PaystackPop) {
      toast('Payment library still loading — try again', 'warning');
      return;
    }
    start(() => {
      // GFP = GymFlow PT pack — distinguishes the reference in admin lookups.
      const ref = 'GFP-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      const popup = new window.PaystackPop!();
      popup.newTransaction({
        key: publicKey,
        email,
        amount: Math.round(amount * 100),
        currency: 'NGN',
        ref,
        metadata: { purpose: 'pt_pack', pack_id: packId, pack_name: packName },
        ...(subaccount ? { subaccount, bearer: 'subaccount' as const } : {}),
        onSuccess: (txn) => {
          fetch('/api/paystack/verify-pt-pack', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reference: txn.reference, pack_id: packId }),
          })
            .then((r) => r.json())
            .then((data) => {
              if (data.success) {
                toast(
                  data.already ? `${packName} already credited.` : `${packName} added to your balance.`,
                  'success',
                );
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
      <Script src="https://js.paystack.co/v2/inline.js" strategy="afterInteractive" onLoad={() => setReady(true)} />
      <button
        type="button"
        className="gf-btn gf-btn-primary"
        onClick={handleClick}
        disabled={!ready || pending}
      >
        {pending ? 'Processing…' : ready ? 'Buy pack' : 'Loading…'}
      </button>
    </>
  );
}
