'use client';

import { useState, useTransition } from 'react';
import { Plus, AlertCircle, Check } from 'lucide-react';
import { logExpense, EXPENSE_CATEGORIES, type FState } from '@/lib/actions/facility';

const INIT: FState = { ok: false, error: null };

// Inline "Log expense" affordance for the Facility page — a trigger that
// expands into a small form and revalidates the page on save.
export function ExpenseForm() {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(fd: FormData) {
    start(async () => {
      const res = await logExpense(INIT, fd);
      if (res.ok) { setSaved(true); setError(null); setOpen(false); }
      else setError(res.error);
    });
  }

  if (!open) {
    return (
      <button type="button" className="link" onClick={() => { setOpen(true); setSaved(false); }} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Plus strokeWidth={2} size={14} /> Log{saved && <Check size={14} strokeWidth={2.6} style={{ marginLeft: 4, color: 'var(--gf-brand)' }} />}
      </button>
    );
  }

  return (
    <form action={submit} style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '4px 0 10px' }}>
      <select className="gf-select" name="category" defaultValue="utilities">
        {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
      </select>
      <input className="gf-input" name="amount" type="number" min="0" step="100" placeholder="Amount (₦)" required />
      <input className="gf-input" name="description" placeholder="Description (optional)" />
      <input className="gf-input" name="expense_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
      {error && <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--gf-danger)', fontSize: '0.82rem' }}><AlertCircle size={14} strokeWidth={2} /> {error}</span>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="gf-btn gf-btn-primary gf-btn-sm" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save expense'}</button>
        <button className="gf-btn gf-btn-secondary gf-btn-sm" type="button" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
