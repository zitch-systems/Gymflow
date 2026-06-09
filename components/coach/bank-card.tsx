'use client';

import { useState, useTransition } from 'react';
import { ArrowRight, Check, AlertCircle } from 'lucide-react';
import { saveBankDetails } from '@/lib/actions/instructor';

type Bank = { bank_name: string; account_number: string; account_name: string; bank_code: string } | null;

// Payout account card — shows the account on file and opens an inline form to
// add or change it (upserts the instructor's own instructor_bank_details row).
export function BankCard({ bank }: { bank: Bank }) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(fd: FormData) {
    start(async () => {
      const res = await saveBankDetails({ ok: false, error: null }, fd);
      if (res.ok) { setSaved(true); setError(null); setEditing(false); }
      else setError(res.error);
    });
  }

  const masked = bank?.account_number ? `•••• ${bank.account_number.slice(-4)}` : null;

  return (
    <div className="bankcard">
      <span className="lbl">Payout account</span>
      {!editing ? (
        <>
          <span className="num">{bank ? `${bank.bank_name} ${masked}` : 'No bank account on file'}</span>
          <span style={{ color: 'var(--gf-text-muted)', fontSize: '0.82rem' }}>{bank?.account_name ?? 'Add a payout account to get paid'}</span>
          {saved && <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--gf-brand)', fontSize: '0.82rem' }}><Check size={14} strokeWidth={2.4} /> Saved.</span>}
          <button type="button" className="link" style={{ marginTop: 6, background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left' }} onClick={() => { setEditing(true); setSaved(false); }}>
            {bank ? 'Change account' : 'Add account'} <ArrowRight strokeWidth={2} size={14} />
          </button>
        </>
      ) : (
        <form action={submit} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          <input className="gf-input" name="bank_name" placeholder="Bank (e.g. GTBank)" defaultValue={bank?.bank_name ?? ''} required />
          <input className="gf-input" name="bank_code" placeholder="Bank code (e.g. 058)" defaultValue={bank?.bank_code ?? ''} inputMode="numeric" />
          <input className="gf-input" name="account_number" placeholder="Account number (10 digits)" defaultValue={bank?.account_number ?? ''} inputMode="numeric" maxLength={10} required />
          <input className="gf-input" name="account_name" placeholder="Account name" defaultValue={bank?.account_name ?? ''} required />
          {error && <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--gf-danger)', fontSize: '0.82rem' }}><AlertCircle size={14} strokeWidth={2} /> {error}</span>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="gf-btn gf-btn-primary gf-btn-sm" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save account'}</button>
            <button className="gf-btn gf-btn-secondary gf-btn-sm" type="button" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
