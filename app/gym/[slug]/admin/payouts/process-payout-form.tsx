'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { processPayout, rejectPayout } from '@/lib/actions/payouts';
import { useToast } from '@/lib/toast';

type Prefill = { bank_code: string; bank_name: string; account_number: string } | undefined;

export function ProcessPayoutForm({
  slug,
  payoutId,
  amount,
  coachName,
  prefill,
}: {
  slug: string;
  payoutId: string;
  amount: number;
  coachName: string;
  prefill: Prefill;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  if (!open) {
    return (
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          className="gf-btn gf-btn-primary gf-btn-sm"
          onClick={() => setOpen(true)}
        >
          Pay
        </button>
        <button
          type="button"
          className="gf-btn gf-btn-ghost gf-btn-sm"
          disabled={pending}
          onClick={() => {
            const reason = window.prompt(`Reject payout for ${coachName}?`, '');
            if (reason === null) return;
            start(async () => {
              const r = await rejectPayout(slug, payoutId, reason);
              if (r.ok) {
                toast('Payout rejected', 'success');
                router.refresh();
              } else {
                toast(r.error ?? 'Failed', 'error');
              }
            });
          }}
        >
          Reject
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        if (!window.confirm(`Send ₦${amount.toLocaleString('en-NG')} to ${coachName}?`)) return;
        start(async () => {
          const r = await processPayout(slug, payoutId, fd);
          if (r.ok) {
            toast('Payout initiated', 'success');
            setOpen(false);
            router.refresh();
          } else {
            toast(r.error ?? 'Failed', 'error');
          }
        });
      }}
      style={{ display: 'grid', gap: 6, minWidth: 220 }}
    >
      <input
        type="text"
        name="bank_name"
        placeholder="Bank name"
        defaultValue={prefill?.bank_name ?? ''}
        required
        className="gf-input"
        style={{ padding: '4px 8px', fontSize: 13 }}
      />
      <input
        type="text"
        name="bank_code"
        placeholder="Bank code (e.g. 058)"
        defaultValue={prefill?.bank_code ?? ''}
        required
        pattern="\d{3,6}"
        className="gf-input"
        style={{ padding: '4px 8px', fontSize: 13 }}
      />
      <input
        type="text"
        name="account_number"
        placeholder="10-digit NUBAN"
        defaultValue={prefill?.account_number ?? ''}
        required
        pattern="\d{10}"
        inputMode="numeric"
        className="gf-input"
        style={{ padding: '4px 8px', fontSize: 13 }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="submit" disabled={pending} className="gf-btn gf-btn-primary gf-btn-sm">
          {pending ? 'Sending…' : 'Send'}
        </button>
        <button
          type="button"
          className="gf-btn gf-btn-ghost gf-btn-sm"
          onClick={() => setOpen(false)}
          disabled={pending}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
