'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { markClassAttendance } from '@/lib/actions/coach';
import { useToast } from '@/lib/toast';

export function ClassAttendanceRow({
  slug,
  bookingId,
  name,
  attended,
}: {
  slug: string;
  bookingId: string;
  name: string;
  attended: boolean;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  return (
    <li style={{ padding: '12px 18px', borderTop: '1px solid var(--gf-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
      <span style={{ fontWeight: 500 }}>{name}</span>
      <button
        type="button"
        disabled={pending}
        className={`gf-btn gf-btn-sm ${attended ? 'gf-btn-primary' : 'gf-btn-outline'}`}
        onClick={() =>
          start(async () => {
            const r = await markClassAttendance(slug, bookingId, !attended);
            if (r.ok) {
              toast(attended ? 'Marked absent' : 'Marked present', 'success');
              router.refresh();
            } else {
              toast(r.error ?? 'Failed', 'error');
            }
          })
        }
      >
        {attended ? '✓ Present' : 'Mark present'}
      </button>
    </li>
  );
}
