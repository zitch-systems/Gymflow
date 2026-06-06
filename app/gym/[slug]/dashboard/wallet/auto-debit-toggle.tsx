'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Repeat } from 'lucide-react';
import { setMemberAutoDebit } from '@/lib/actions/subscription';
import { useToast } from '@/lib/toast';
import { fmtDate } from '@/lib/format';

type Props = {
  slug: string;
  enabled: boolean;
  endDate: string | null;
  cardLast4: string | null;
  cardBrand: string | null;
};

// Ports revamp/member.css .toggle-row + .switch. The flag this writes
// (memberships.auto_debit_enabled) is what /api/cron/auto-debit filters on
// every morning at 05:00 UTC — flipping it on is the only thing standing
// between a member and a real recurring charge.
export function AutoDebitToggle({ slug, enabled, endDate, cardLast4, cardBrand }: Props) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const hasCard = !!cardLast4;

  const subline = enabled
    ? endDate
      ? `Renew automatically on ${fmtDate(endDate)}${cardLast4 ? ` · ${cardBrand ?? 'card'} ${cardLast4}` : ''}`
      : 'Renew automatically when your plan ends'
    : hasCard
      ? `Pay manually on each renewal · saved ${cardBrand ?? 'card'} ${cardLast4}`
      : 'Pay manually on each renewal · no saved card yet';

  const handleToggle = () => {
    if (pending) return;
    const next = !enabled;
    if (next && !hasCard) {
      toast('Renew once with a card first to enable auto-debit.', 'warning');
      return;
    }
    start(async () => {
      const res = await setMemberAutoDebit(slug, next);
      if (res.ok) {
        toast(next ? 'Auto-debit on.' : 'Auto-debit off.', 'success');
        router.refresh();
      } else {
        toast(res.error ?? 'Could not update auto-debit', 'error');
      }
    });
  };

  return (
    <div className="toggle-row">
      <span className="ic" aria-hidden><Repeat strokeWidth={1.9} /></span>
      <div className="m">
        <strong>Auto-debit</strong>
        <small>{subline}</small>
      </div>
      <button
        type="button"
        className={`switch${enabled ? ' on' : ''}`}
        onClick={handleToggle}
        disabled={pending}
        role="switch"
        aria-checked={enabled}
        aria-label="Toggle auto-debit"
      />
    </div>
  );
}
