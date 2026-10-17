'use client';

import { useActionState } from 'react';
import { CheckCheck } from 'lucide-react';
import { markAllRead } from '@/lib/actions/notifications';

export function MarkNotificationsRead({ hasUnread }: { hasUnread: boolean }) {
  const [state, action, pending] = useActionState(markAllRead, { ok: false, error: null });
  return <form action={action} aria-busy={pending} style={{ position: 'relative' }}>
    <button type="submit" className="icon-btn" style={{ width: 34, height: 34 }} disabled={pending || !hasUnread} title="Mark all read" aria-label={pending ? 'Marking notifications read' : 'Mark all read'}>
      <CheckCheck strokeWidth={1.9} />
    </button>
    {state.ok && <span role="status" className="sr-only">All notifications marked as read.</span>}
    {state.error && <p role="alert" style={{ position: 'absolute', right: 0, width: 240, zIndex: 2, padding: 12, background: 'var(--gf-surface)', border: '1px solid var(--gf-border)', borderRadius: 8, fontSize: '0.8rem' }}>{state.error}</p>}
  </form>;
}
