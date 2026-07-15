'use client';

import { useState, useTransition } from 'react';
import { ArrowRight, Check, AlertCircle } from 'lucide-react';
import { saveBankDetails, verifyInstructorBankAccount } from '@/lib/actions/instructor';

type Bank = { bank_name: string; account_number: string; account_name: string; bank_code: string } | null;

// Payout account card — shows the account on file and opens an inline form to
// add or change it (upserts the instructor's own instructor_bank_details row).
// Changing it redirects where the instructor's own earnings get paid, so it
// requires a password (step-up authorization) and, when Paystack is
// configured, a verified account name before it can be saved.
export function BankCard({ bank, payoutsAvailable }: { bank: Bank; payoutsAvailable: boolean }) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const [bankName, setBankName] = useState(bank?.bank_name ?? '');
  const [bankCode, setBankCode] = useState(bank?.bank_code ?? '');
  const [accountNumber, setAccountNumber] = useState(bank?.account_number ?? '');
  const [accountName, setAccountName] = useState(bank?.account_name ?? '');
  const [verified, setVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  function resetVerification() {
    setVerified(false); setVerifyError(null);
  }

  async function verify() {
    setVerifying(true); setVerifyError(null);
    const r = await verifyInstructorBankAccount(accountNumber, bankCode);
    setVerifying(false);
    if (r.ok) { setAccountName(r.accountName); setVerified(true); }
    else { setVerifyError(r.error); setVerified(false); }
  }

  function submit(fd: FormData) {
    start(async () => {
      const res = await saveBankDetails({ ok: false, error: null }, fd);
      if (res.ok) { setSaved(true); setError(null); setEditing(false); }
      else setError(res.error);
    });
  }

  const canVerify = /^\d{10}$/.test(accountNumber) && /^\d{3,6}$/.test(bankCode) && !verifying;
  const canSubmit = bankName.trim().length > 0 && accountName.trim().length > 0
    && /^\d{10}$/.test(accountNumber) && (!payoutsAvailable || verified) && !pending;

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
          <input type="hidden" name="account_name" value={accountName} readOnly />
          <input className="gf-input" name="bank_name" placeholder="Bank (e.g. GTBank)" value={bankName} onChange={(e) => setBankName(e.target.value)} required />
          <input className="gf-input" name="bank_code" placeholder="Bank code (e.g. 058)" value={bankCode} onChange={(e) => { setBankCode(e.target.value.replace(/\D/g, '').slice(0, 6)); resetVerification(); }} inputMode="numeric" />
          <input className="gf-input" placeholder="Account number (10 digits)" value={accountNumber} onChange={(e) => { setAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 10)); resetVerification(); }} inputMode="numeric" maxLength={10} required />
          <input className="gf-input" placeholder="Account name" value={accountName} onChange={(e) => { setAccountName(e.target.value); resetVerification(); }} required />

          {payoutsAvailable && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" className="gf-btn gf-btn-secondary gf-btn-sm" onClick={verify} disabled={!canVerify}>
                {verifying ? 'Verifying…' : 'Verify account'}
              </button>
              {verified && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--gf-success)', fontWeight: 600, fontSize: '0.82rem' }}>
                  <Check size={14} strokeWidth={2.4} /> Verified
                </span>
              )}
              {verifyError && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--gf-danger)', fontSize: '0.8rem' }}>
                  <AlertCircle size={14} strokeWidth={2} /> {verifyError}
                </span>
              )}
            </div>
          )}

          <input className="gf-input" type="password" name="password" placeholder="Confirm your password" autoComplete="current-password" required />

          {error && <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--gf-danger)', fontSize: '0.82rem' }}><AlertCircle size={14} strokeWidth={2} /> {error}</span>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="gf-btn gf-btn-primary gf-btn-sm" type="submit" disabled={!canSubmit}>{pending ? 'Saving…' : 'Save account'}</button>
            <button className="gf-btn gf-btn-secondary gf-btn-sm" type="button" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
