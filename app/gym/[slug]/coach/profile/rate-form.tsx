'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateInstructorRate } from '@/lib/actions/coach';
import { useToast } from '@/lib/toast';

export function RateForm({ slug, initial }: { slug: string; initial: number | null }) {
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
        start(async () => {
          const r = await updateInstructorRate(slug, fd);
          if (r.ok) {
            toast('Rate updated', 'success');
            router.refresh();
          } else {
            toast(r.error ?? 'Failed', 'error');
          }
        });
      }}
    >
      <div className="gf-form-group form-grid-full">
        <label className="gf-label" htmlFor="price">Monthly rate (₦) <span className="req">*</span></label>
        <input id="price" name="price" type="number" min="0" step="100" required defaultValue={initial ?? ''} className="gf-input" />
        <p className="gf-form-hint">What members pay to subscribe to you for a month.</p>
      </div>
      <button type="submit" disabled={pending} className="gf-btn gf-btn-primary form-grid-full">
        {pending ? 'Saving…' : 'Save rate'}
      </button>
    </form>
  );
}
