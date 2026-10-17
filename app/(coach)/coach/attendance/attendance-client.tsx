'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCheck, Check, X } from 'lucide-react';
import { markSession } from '@/lib/actions/instructor';
import { pendingAttendance, saveAttendance, type AttendanceStatus } from './attendance-requests';

export type Session = { id: string; name: string; initial: string; time: string; status: string };

export function AttendanceClient({ sessions }: { sessions: Session[] }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const router = useRouter();

  function mark(selected: Session[], status: AttendanceStatus) {
    if (saving.current || !selected.length) return;
    saving.current = true;
    setError(null);
    setMessage(null);
    start(async () => {
      try {
        const result = await saveAttendance(selected, status, markSession);
        if (result.errors.length) setError(result.errors.join(' '));
        if (result.saved) setMessage(`${result.saved} session${result.saved === 1 ? '' : 's'} saved.`);
        router.refresh();
      } finally {
        saving.current = false;
      }
    });
  }

  const done = sessions.filter((s) => s.status === 'completed').length;
  const scheduled = pendingAttendance(sessions);

  return (
    <div className="panel" aria-busy={pending}>
      <div className="panel-h" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div><h3>Today&apos;s sessions</h3><div className="sub">{done} marked done · {scheduled.length} pending</div></div>
        <button type="button" className="gf-btn gf-btn-sm gf-btn-primary" disabled={pending || scheduled.length === 0}
          onClick={() => mark(sessions.filter((s) => s.status === 'scheduled'), 'completed')}>
          <CheckCheck strokeWidth={1.9} size={15} /> {pending ? 'Saving…' : 'Mark all done'}
        </button>
      </div>
      {error && <p role="alert" className="act-fb err">{error}</p>}
      {message && <p role="status" className="act-fb">{message}</p>}
      {sessions.length === 0 ? (
        <div className="empty"><div className="eic"><Check strokeWidth={1.6} /></div><h3>No sessions today</h3><p>PT sessions for today appear here to mark.</p></div>
      ) : sessions.map((s) => {
        const isDone = s.status === 'completed';
        const isNo = s.status === 'no_show';
        const editable = ['scheduled', 'completed', 'no_show'].includes(s.status);
        return (
          <div className="ar" key={s.id} style={{ flexWrap: 'wrap', gap: 10 }}>
            <span className="gf-avatar gf-avatar-sm">{s.initial}</span>
            <div className="m" style={{ flex: 1, minWidth: 100 }}>
              <strong style={{ fontFamily: 'var(--gf-font-display)', fontSize: '0.88rem', display: 'block' }}>{s.name}</strong>
              <small style={{ color: 'var(--gf-text-muted)' }}>{s.time} · {isDone ? 'Completed' : isNo ? 'No-show' : editable ? 'Scheduled' : 'Cancelled'}</small>
            </div>
            {editable ? <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className={`gf-btn gf-btn-sm ${isDone ? 'gf-btn-primary' : 'gf-btn-secondary'}`} disabled={pending || isDone} onClick={() => mark([s], 'completed')} aria-label={`Mark ${s.name} attended`} aria-pressed={isDone}>
                {isDone ? <><Check strokeWidth={2.4} size={14} /> Attended</> : 'Mark in'}
              </button>
              <button type="button" className={`gf-btn gf-btn-sm ${isNo ? 'gf-btn-danger' : 'gf-btn-ghost'}`} disabled={pending || isNo} onClick={() => mark([s], 'no_show')} aria-label={`Mark ${s.name} no-show`} aria-pressed={isNo}>
                <X strokeWidth={2.2} size={14} /> No-show
              </button>
            </div> : <span className="gf-badge gf-badge-neutral">Cancelled</span>}
          </div>
        );
      })}
    </div>
  );
}
