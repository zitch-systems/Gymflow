'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveBankDetails } from '@/lib/actions/coach';
import { useToast } from '@/lib/toast';

type Initial = {
  bank_code: string | null;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
};

export function BankDetailsForm({ slug, initial }: { slug: string; initial: Initial }) {
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
          const r = await saveBankDetails(slug, fd);
          if (r.ok) {
            toast('Bank details saved & verified', 'success');
            router.refresh();
          } else {
            toast(r.error ?? 'Failed', 'error');
          }
        });
      }}
    >
      {initial.account_name && (
        <div className="form-grid-full" style={{ marginBottom: 4 }}>
          <span className="status-pill on">Verified · {initial.account_name}</span>
        </div>
      )}
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="bank_name">Bank name <span className="req">*</span></label>
        <input id="bank_name" name="bank_name" className="gf-input" defaultValue={initial.bank_name ?? ''} placeholder="GTBank" required />
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="bank_code">Bank code <span className="req">*</span></label>
        <input id="bank_code" name="bank_code" className="gf-input" defaultValue={initial.bank_code ?? ''} placeholder="058" pattern="\d{3,6}" inputMode="numeric" required />
        <p className="gf-form-hint">Your bank&apos;s Paystack code. Ask the gym if unsure.</p>
      </div>
      <div className="gf-form-group form-grid-full">
        <label className="gf-label" htmlFor="account_number">Account number (NUBAN) <span className="req">*</span></label>
        <input id="account_number" name="account_number" className="gf-input" defaultValue={initial.account_number ?? ''} placeholder="0123456789" pattern="\d{10}" inputMode="numeric" required />
        <p className="gf-form-hint">We verify this with your bank before saving.</p>
      </div>
      <button type="submit" disabled={pending} className="gf-btn gf-btn-primary form-grid-full">
        {pending ? 'Verifying…' : 'Save bank details'}
      </button>
    </form>
  );
}
