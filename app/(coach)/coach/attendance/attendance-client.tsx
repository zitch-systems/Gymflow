'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCheck, Check, X } from 'lucide-react';
import { markSession } from '@/lib/actions/instructor';

export type Session = { id: string; name: string; initial: string; time: string; status: string };

export function AttendanceClient({ sessions }: { sessions: Session[] }) {
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const router = useRouter();

  function mark(id: string, status: 'completed' | 'no_show') {
    setBusyId(id);
    start(async () => { await markSession(id, status); setBusyId(null); router.refresh(); });
  }

  const done = sessions.filter((s) => s.status === 'completed').length;
  const pendingCount = sessions.filter((s) => s.status !== 'completed' && s.status !== 'no_show').length;

  return (
    <div className="panel">
      <div className="panel-h">
        <div><h3>Today&apos;s sessions</h3><div className="sub">{done} marked done · {pendingCount} pending</div></div>
        <button className="gf-btn gf-btn-sm gf-btn-primary" disabled={pending || pendingCount === 0}
          onClick={() => start(async () => { for (const s of sessions.filter((x) => x.status !== 'completed' && x.status !== 'no_show')) await markSession(s.id, 'completed'); router.refresh(); })}>
          <CheckCheck strokeWidth={1.9} size={15} /> Mark all done
        </button>
      </div>
      {sessions.length === 0 ? (
        <div className="empty"><div className="eic"><Check strokeWidth={1.6} /></div><h3>No sessions today</h3><p>PT sessions for today appear here to mark.</p></div>
      ) : sessions.map((s) => {
        const isDone = s.status === 'completed';
        const isNo = s.status === 'no_show';
        return (
          <div className="ar" key={s.id}>
            <span className="gf-avatar gf-avatar-sm">{s.initial}</span>
            <div className="m" style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ fontFamily: 'var(--gf-font-display)', fontSize: '0.88rem', display: 'block' }}>{s.name}</strong>
              <small style={{ color: 'var(--gf-text-muted)' }}>{s.time}</small>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className={`gf-btn gf-btn-sm ${isDone ? 'gf-btn-primary' : 'gf-btn-secondary'}`} disabled={pending && busyId === s.id} onClick={() => mark(s.id, 'completed')}>
                {isDone ? <><Check strokeWidth={2.4} size={14} /> In</> : 'Mark in'}
              </button>
              <button className={`gf-btn gf-btn-sm ${isNo ? 'gf-btn-danger' : 'gf-btn-ghost'}`} disabled={pending && busyId === s.id} onClick={() => mark(s.id, 'no_show')} aria-label="No show">
                <X strokeWidth={2.2} size={14} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
