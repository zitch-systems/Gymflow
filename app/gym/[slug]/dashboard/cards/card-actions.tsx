'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteSavedCard, setDefaultSavedCard } from '@/lib/actions/cards';
import { useToast } from '@/lib/toast';

export function CardActions({ cardId, isDefault }: { cardId: string; isDefault: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {!isDefault && (
        <button
          type="button"
          className="gf-btn gf-btn-ghost gf-btn-sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await setDefaultSavedCard(cardId);
              if (r.ok) {
                toast('Set as default', 'success');
                router.refresh();
              } else {
                toast(r.error ?? 'Failed', 'error');
              }
            })
          }
        >
          Make default
        </button>
      )}
      <button
        type="button"
        className="gf-btn gf-btn-ghost gf-btn-sm"
        disabled={pending}
        onClick={() => {
          if (!confirm('Remove this card? Auto-renewal will stop using it.')) return;
          start(async () => {
            const r = await deleteSavedCard(cardId);
            if (r.ok) {
              toast('Card removed', 'success');
              router.refresh();
            } else {
              toast(r.error ?? 'Failed', 'error');
            }
          });
        }}
      >
        Remove
      </button>
    </div>
  );
}
