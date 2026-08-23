'use client';

import { useState, useTransition } from 'react';
import { Send, Check } from 'lucide-react';
import { remindMember, remindAllDue } from '@/lib/actions/reminders';

// "Send all due" — nudges every membership expiring this week (deduped
// server-side, so re-clicking won't spam members).
export function RemindAllButton() {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function run() {
    start(async () => {
      const res = await remindAllDue();
      setMsg(res.ok ? `${res.sent} reminder${res.sent === 1 ? '' : 's'} sent` : res.error);
    });
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {msg && <span style={{ fontSize: '0.84rem', color: 'var(--gf-text-secondary)' }}>{msg}</span>}
      <button className="gf-btn gf-btn-primary" onClick={run} disabled={pending}>
        <Send strokeWidth={1.9} size={16} /> {pending ? 'Sending…' : 'Send all due'}
      </button>
    </div>
  );
}

// Per-member "Remind" on the expiring list.
export function RemindButton({ subscriptionId }: { subscriptionId: string }) {
  const [done, setDone] = useState<'sent' | 'already' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function run() {
    setError(null);
    start(async () => {
      const res = await remindMember(subscriptionId);
      if (res.ok) setDone(res.sent > 0 ? 'sent' : 'already');
      else setError(res.error);
    });
  }
  if (done) return <span className="gf-badge gf-badge-success"><Check size={12} strokeWidth={2.4} /> {done === 'sent' ? 'Sent' : 'Already sent'}</span>;
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {error && <span style={{ fontSize: '0.78rem', color: 'var(--gf-danger)' }}>{error}</span>}
      <button className="gf-btn gf-btn-sm gf-btn-primary" onClick={run} disabled={pending}>
        {pending ? 'Sending…' : 'Remind'}
      </button>
    </div>
  );
}
