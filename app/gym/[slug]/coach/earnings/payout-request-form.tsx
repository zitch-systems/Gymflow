'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { requestPayout } from '@/lib/actions/coach';
import { useToast } from '@/lib/toast';

export function PayoutRequestForm({ slug, max }: { slug: string; max: number }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  return (
    <form
      className="form-grid"
      style={{ padding: 18 }}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const form = e.currentTarget;
        start(async () => {
          const r = await requestPayout(slug, fd);
          if (r.ok) {
            toast('Payout requested', 'success');
            form.reset();
            router.refresh();
          } else {
            toast(r.error ?? 'Failed', 'error');
          }
        });
      }}
    >
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="amount">Amount (₦) <span className="req">*</span></label>
        <input id="amount" name="amount" type="number" min="1" max={max || undefined} step="100" required className="gf-input" />
        <p className="gf-form-hint">Available: ₦{max.toLocaleString('en-NG')}</p>
      </div>
      <div className="gf-form-group form-grid-full">
        <label className="gf-label" htmlFor="notes">Note for admin (optional)</label>
        <input id="notes" name="notes" className="gf-input" placeholder="Bank details, urgency…" />
      </div>
      <button type="submit" disabled={pending || max <= 0} className="gf-btn gf-btn-primary form-grid-full">
        {pending ? 'Submitting…' : 'Request payout'}
      </button>
    </form>
  );
}
