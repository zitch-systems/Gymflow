'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { markSessionStatus } from '@/lib/actions/coach';
import { useToast } from '@/lib/toast';

type Status = 'scheduled' | 'completed' | 'no_show' | 'cancelled';

export function SessionAttendanceRow({
  slug,
  sessionId,
  name,
  scheduledAt,
  duration,
  status,
}: {
  slug: string;
  sessionId: string;
  name: string;
  scheduledAt: string;
  duration: number;
  status: Status;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function mark(next: Exclude<Status, 'scheduled'>) {
    start(async () => {
      const r = await markSessionStatus(slug, sessionId, next);
      if (r.ok) {
        toast(`Marked ${next.replace('_', ' ')}`, 'success');
        router.refresh();
      } else {
        toast(r.error ?? 'Failed', 'error');
      }
    });
  }

  return (
    <li style={{ padding: '12px 18px', borderTop: '1px solid var(--gf-border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: status === 'scheduled' ? 8 : 0 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{name}</div>
          <div style={{ fontSize: '0.8125rem', color: 'var(--gf-text-muted)' }}>
            {new Date(scheduledAt).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })} · {duration} min
          </div>
        </div>
        <span className={`status-pill ${status === 'completed' ? 'on' : status === 'scheduled' ? '' : 'off'}`}>{status.replace('_', ' ')}</span>
      </div>
      {status === 'scheduled' && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" disabled={pending} className="gf-btn gf-btn-primary gf-btn-sm" onClick={() => mark('completed')}>Complete</button>
          <button type="button" disabled={pending} className="gf-btn gf-btn-outline gf-btn-sm" onClick={() => mark('no_show')}>No show</button>
          <button type="button" disabled={pending} className="gf-btn gf-btn-ghost gf-btn-sm" onClick={() => mark('cancelled')}>Cancel</button>
        </div>
      )}
    </li>
  );
}
