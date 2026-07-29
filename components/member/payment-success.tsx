'use client';

import type { Route } from 'next';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { CheckCircle2, X } from 'lucide-react';

export type PaidReceipt = {
  reference: string;
  amount: string;
  method: string | null;
  planName: string | null;
  /** Formatted expiry after this payment, when the renewal moved it. */
  activeUntil: string | null;
  receiptHref: Route | null;
};

/**
 * "Payment successful" confirmation, shown in the member portal.
 *
 * Paystack used to return members to a standalone result page with a button
 * back to the dashboard — a dead end that read like part of the payment
 * processor rather than their gym. Now the callback fulfils and redirects into
 * the portal, and this modal confirms it over the dashboard they already know,
 * with the numbers that matter: what was charged, on what plan, and how long
 * they are now covered for.
 *
 * The query parameter is stripped on dismissal, so a refresh (or a shared URL)
 * doesn't replay a stale confirmation.
 */
export function PaymentSuccess({ receipt }: { receipt: PaidReceipt }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Mount closed, then open — the CSS transition needs a frame with .gfui-bg
  // present but not yet .open, or the modal appears without animating.
  useEffect(() => {
    const id = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  function dismiss() {
    setOpen(false);
    // Let the close transition finish before dropping ?paid= from the URL.
    // pathname is the route we are already on, so it is a valid Route.
    setTimeout(() => router.replace(pathname as Route), 220);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') dismiss(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dismiss is stable for this modal's lifetime
  }, []);

  return (
    <div
      className={`gfui-bg${open ? ' open' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="paid-title"
      onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
    >
      <div className="gfui-modal">
        <div className="gfui-h">
          <span className="gfui-ic"><CheckCircle2 strokeWidth={1.9} /></span>
          <div className="gfui-tt">
            <h3 id="paid-title">Payment successful</h3>
            <p>Your membership is up to date.</p>
          </div>
          <button ref={closeRef} className="gfui-x" onClick={dismiss} aria-label="Close">
            <X strokeWidth={2} />
          </button>
        </div>

        <div className="gfui-b">
          <div className="gfui-rows">
            <div className="r"><span>Amount</span><strong>{receipt.amount}</strong></div>
            {receipt.planName && <div className="r"><span>Plan</span><strong>{receipt.planName}</strong></div>}
            {receipt.activeUntil && <div className="r"><span>Active until</span><strong>{receipt.activeUntil}</strong></div>}
            {receipt.method && <div className="r"><span>Paid with</span><strong style={{ textTransform: 'capitalize' }}>{receipt.method}</strong></div>}
            <div className="r"><span>Reference</span><strong style={{ fontFamily: 'var(--gf-font-mono, monospace)', fontSize: '0.8rem' }}>{receipt.reference}</strong></div>
          </div>
        </div>

        <div className="gfui-f">
          {receipt.receiptHref && (
            <Link href={receipt.receiptHref} className="gf-btn gf-btn-secondary gf-btn-sm" onClick={() => setOpen(false)}>
              View receipt
            </Link>
          )}
          <button className="gf-btn gf-btn-primary gf-btn-sm" onClick={dismiss}>Done</button>
        </div>
      </div>
    </div>
  );
}
