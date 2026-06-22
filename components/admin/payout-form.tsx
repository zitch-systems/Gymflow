'use client';

import { useState, useActionState } from 'react';
import { Check, AlertCircle } from 'lucide-react';
import { savePayout, verifyBankAccount, type GymSaveState } from '@/lib/actions/gym';
import type { Bank } from '@/lib/paystack';

const INIT: GymSaveState = { ok: false, error: null };

type PayoutGym = {
  bank_name: string | null; bank_code: string | null; account_number: string | null; account_name: string | null;
  payouts_connected: boolean; commission_pct: number;
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
  function pickBank(name: string) {
    setBankName(name);
    setBankCode(banks.find((b) => b.name.toLowerCase() === name.toLowerCase())?.code ?? '');
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
  const canSubmit = hasBankList ? verified && !savePending : !savePending;

  return (
    <form className="panel" action={saveAction}>
      <div className="panel-title">Payout account</div>
      <div className="panel-desc">
        Where member dues settle. {gym.payouts_connected ? 'Connected to Paystack — collections settle to this account (T+1).' : 'Add your bank to receive member payments directly — no Paystack account needed, just your bank.'}
        {gym.commission_pct > 0 ? ` Platform fee: ${gym.commission_pct}%.` : ''}
      </div>
      <div style={{ marginBottom: 14 }}>
        <span className={`gf-badge ${gym.payouts_connected ? 'gf-badge-success' : 'gf-badge-neutral'}`}><span className="gf-dot" />{gym.payouts_connected ? 'Payouts connected' : 'Not connected'}</span>
      </div>

      {hasBankList ? (
        <>
          <input type="hidden" name="bank_name" value={bankName} readOnly />
          <input type="hidden" name="bank_code" value={bankCode} readOnly />
          <input type="hidden" name="account_number" value={accountNumber} readOnly />
          <input type="hidden" name="account_name" value={accountName} readOnly />
          <div className="frow">
            <div className="gf-form-group">
              <label className="gf-form-label">Bank</label>
              <input className="gf-input" list="gf-bank-list" value={bankName} onChange={(e) => pickBank(e.target.value)} placeholder="Search your bank…" autoComplete="off" />
              <datalist id="gf-bank-list">{banks.map((b) => <option key={b.code} value={b.name} />)}</datalist>
              {bankName && !bankCode && <span className="gf-form-hint" style={{ color: 'var(--gf-warning)' }}>Pick a bank from the list.</span>}
            </div>
            <div className="gf-form-group">
              <label className="gf-form-label">Account number</label>
              <input className="gf-input" value={accountNumber} onChange={(e) => onAccountNumber(e.target.value)} placeholder="10 digits" inputMode="numeric" maxLength={10} />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '2px 0 12px', flexWrap: 'wrap' }}>
            <button type="button" className="gf-btn gf-btn-secondary gf-btn-sm" onClick={verify} disabled={!canVerify}>
              {verifying ? 'Verifying…' : 'Verify account'}
            </button>
            {verified && accountName && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--gf-success)', fontWeight: 600, fontSize: '0.9rem' }}>
                <Check size={16} strokeWidth={2.4} /> {accountName}
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
          {savePending ? 'Saving…' : (gym.payouts_connected ? 'Update payout account' : 'Connect payouts')}
        </button>
        {saveState.ok && <span style={{ color: 'var(--gf-success)', fontSize: '0.84rem', fontWeight: 600 }}>Saved ✓</span>}
        {saveState.error && <span style={{ color: 'var(--gf-danger)', fontSize: '0.84rem', fontWeight: 600 }}>{saveState.error}</span>}
      </div>
      {hasBankList && !verified && <p style={{ color: 'var(--gf-text-muted)', fontSize: '0.8rem', marginTop: 8 }}>Verify the account to enable connecting.</p>}
    </form>
  );
}
