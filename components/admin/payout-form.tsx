'use client';

import { useState, useActionState } from 'react';
import { Check, AlertCircle } from 'lucide-react';
import { savePayout, verifyBankAccount, type GymSaveState } from '@/lib/actions/gym';
import type { Bank } from '@/lib/paystack';

const INIT: GymSaveState = { ok: false, error: null };

type PayoutGym = {
  bank_name: string | null; bank_code: string | null; account_number: string | null; account_name: string | null;
  payouts_connected: boolean; payouts_locked: boolean; commission_pct: number;
};

// Payout setup. When the Paystack bank list is available it's a searchable
// dropdown + account-name verification (the account must resolve before it can
// be connected). Falls back to manual entry when Paystack isn't configured.
export function PayoutForm({ gym, banks }: { gym: PayoutGym; banks: Bank[] }) {
  const hasBankList = banks.length > 0;
  const [saveState, saveAction, savePending] = useActionState(savePayout, INIT);

  const [bankName, setBankName] = useState(gym.bank_name ?? '');
  const [bankCode, setBankCode] = useState(gym.bank_code ?? '');
  const [accountNumber, setAccountNumber] = useState(gym.account_number ?? '');
  const [accountName, setAccountName] = useState(gym.account_name ?? '');
  const [verified, setVerified] = useState(gym.payouts_connected && !!gym.account_name);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // Any edit invalidates a prior verification — force a re-check before connect.
  // Pick by the bank's Paystack code (from the <select>) so a valid code is
  // always set — the old free-text datalist left bank_code empty unless the
  // typed text matched a list entry exactly, which disabled the submit button.
  function pickBankByCode(code: string) {
    setBankCode(code);
    setBankName(banks.find((b) => b.code === code)?.name ?? '');
    setVerified(false); setAccountName(''); setVerifyError(null);
  }
  function onAccountNumber(v: string) {
    setAccountNumber(v.replace(/\D/g, '').slice(0, 10));
    setVerified(false); setAccountName(''); setVerifyError(null);
  }

  async function verify() {
    setVerifying(true); setVerifyError(null);
    const r = await verifyBankAccount(accountNumber, bankCode);
    setVerifying(false);
    if (r.ok) { setAccountName(r.accountName); setVerified(true); }
    else { setVerifyError(r.error); setVerified(false); setAccountName(''); }
  }

  const canVerify = /^\d{10}$/.test(accountNumber) && /^\d{3,6}$/.test(bankCode) && !verifying;
  // Verification is optional — a gym can save any account so long as the fields
  // are validly filled. Verifying just auto-fills and confirms the holder name.
  const canSubmit = hasBankList
    ? /^\d{10}$/.test(accountNumber) && /^\d{3,6}$/.test(bankCode) && accountName.trim().length > 0 && !savePending
    : !savePending;

  return (
    <form className="panel" action={saveAction}>
      <div className="panel-title">Payout account</div>
      <div className="panel-desc">
        Where member dues settle. {gym.payouts_connected ? 'Connected to Paystack — collections settle to this account (T+1).' : 'Add your bank to receive member payments directly — no Paystack account needed, just your bank.'}
        {gym.commission_pct > 0 ? ` Platform fee: ${gym.commission_pct}%.` : ''}
        {gym.payouts_locked && (
          <><br /><em>Bank on file is locked. Submitting a new account raises a change request for platform review — your current bank stays active until it&rsquo;s approved. The account holder&rsquo;s name must match your business name unless the platform overrides it.</em></>
        )}
      </div>
      <div style={{ marginBottom: 14 }}>
        <span className={`gf-badge ${gym.payouts_connected ? 'gf-badge-success' : 'gf-badge-neutral'}`}><span className="gf-dot" />{gym.payouts_connected ? 'Payouts connected' : 'Not connected'}</span>
      </div>

      {hasBankList ? (
        <>
          <input type="hidden" name="bank_name" value={bankName} readOnly />
          <input type="hidden" name="bank_code" value={bankCode} readOnly />
          <input type="hidden" name="account_number" value={accountNumber} readOnly />
          <div className="frow">
            <div className="gf-form-group">
              <label className="gf-form-label">Bank</label>
              <select className="gf-select" value={bankCode} onChange={(e) => pickBankByCode(e.target.value)}>
                <option value="">Select your bank…</option>
                {banks.map((b, i) => <option key={`${b.code}-${i}`} value={b.code}>{b.name}</option>)}
              </select>
            </div>
            <div className="gf-form-group">
              <label className="gf-form-label">Account number</label>
              <input className="gf-input" value={accountNumber} onChange={(e) => onAccountNumber(e.target.value)} placeholder="10 digits" inputMode="numeric" maxLength={10} />
            </div>
          </div>
          <div className="gf-form-group">
            <label className="gf-form-label">Account name</label>
            <input className="gf-input" name="account_name" value={accountName} onChange={(e) => { setAccountName(e.target.value); setVerified(false); }} placeholder="Account holder name" />
            <span className="gf-form-hint" style={{ color: 'var(--gf-text-muted)' }}>Verify to auto-fill, or type it in — verification is optional.</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '2px 0 12px', flexWrap: 'wrap' }}>
            <button type="button" className="gf-btn gf-btn-secondary gf-btn-sm" onClick={verify} disabled={!canVerify}>
              {verifying ? 'Verifying…' : 'Verify account'}
            </button>
            {verified && accountName && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--gf-success)', fontWeight: 600, fontSize: '0.9rem' }}>
                <Check size={16} strokeWidth={2.4} /> Verified: {accountName}
              </span>
            )}
            {verifyError && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--gf-danger)', fontSize: '0.84rem' }}>
                <AlertCircle size={14} strokeWidth={2} /> {verifyError}
              </span>
            )}
          </div>
        </>
      ) : (
        // Paystack not configured (no bank list) — manual entry; still saves the bank.
        <>
          <div className="frow">
            <div className="gf-form-group"><label className="gf-form-label">Bank name</label><input className="gf-input" name="bank_name" defaultValue={gym.bank_name ?? ''} placeholder="e.g. GTBank" required /></div>
            <div className="gf-form-group"><label className="gf-form-label">Bank code</label><input className="gf-input" name="bank_code" defaultValue={gym.bank_code ?? ''} placeholder="e.g. 058" inputMode="numeric" required /></div>
          </div>
          <div className="frow">
            <div className="gf-form-group"><label className="gf-form-label">Account number</label><input className="gf-input" name="account_number" defaultValue={gym.account_number ?? ''} placeholder="10 digits" inputMode="numeric" maxLength={10} required /></div>
            <div className="gf-form-group"><label className="gf-form-label">Account name</label><input className="gf-input" name="account_name" defaultValue={gym.account_name ?? ''} required /></div>
          </div>
        </>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
        <button className="gf-btn gf-btn-primary" type="submit" disabled={!canSubmit}>
          {savePending ? 'Saving…' : gym.payouts_locked ? 'Request account change' : gym.payouts_connected ? 'Update payout account' : 'Connect payouts'}
        </button>
        {saveState.ok && <span style={{ color: 'var(--gf-success)', fontSize: '0.84rem', fontWeight: 600 }}>Saved ✓</span>}
        {saveState.error && <span style={{ color: 'var(--gf-danger)', fontSize: '0.84rem', fontWeight: 600 }}>{saveState.error}</span>}
      </div>
    </form>
  );
}
