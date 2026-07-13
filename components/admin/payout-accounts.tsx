'use client';

import { useState, useActionState } from 'react';
import { Check, AlertCircle, Trash2, Plus, Star } from 'lucide-react';
import {
  addPayoutAccount, setActivePayoutAccount, removePayoutAccount, type PayoutState,
} from '@/lib/actions/payout-accounts';
import { verifyBankAccount } from '@/lib/actions/gym';
import type { Bank } from '@/lib/paystack';

const INIT: PayoutState = { ok: false, error: null };
const MAX_ACCOUNTS = 4;

export type PayoutAccount = {
  id: string; bank_name: string; bank_code: string; account_number: string;
  account_name: string; verified: boolean; is_active: boolean;
};

type PayoutMeta = { payouts_connected: boolean; commission_pct: number };

// Manage up to four payout accounts and choose which one is active. The active
// account is where member dues settle; switching between a gym's own saved
// accounts is instant and self-service — no platform approval.
export function PayoutAccounts({ accounts, meta, banks }: { accounts: PayoutAccount[]; meta: PayoutMeta; banks: Bank[] }) {
  const hasBankList = banks.length > 0;
  const atMax = accounts.length >= MAX_ACCOUNTS;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="panel">
        <div className="panel-title">Payout accounts</div>
        <div className="panel-desc">
          Where member dues settle. Save up to {MAX_ACCOUNTS} bank accounts and pick which one is active — collections settle to the active account (T+1).
          {meta.commission_pct > 0 ? ` Platform fee: ${meta.commission_pct}%.` : ''}
        </div>
        <div style={{ marginTop: 12 }}>
          <span className={`gf-badge ${meta.payouts_connected ? 'gf-badge-success' : 'gf-badge-neutral'}`}><span className="gf-dot" />{meta.payouts_connected ? 'Payouts connected' : 'Not connected'}</span>
        </div>

        {accounts.length > 0 ? (
          <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
            {accounts.map((a) => <AccountRow key={a.id} account={a} />)}
          </div>
        ) : (
          <div className="panel-desc" style={{ marginTop: 16 }}>No payout account yet — add your bank below to start receiving member payments.</div>
        )}
      </div>

      {atMax ? (
        <div className="panel-desc" style={{ color: 'var(--gf-text-muted)' }}>
          You&rsquo;ve saved the maximum of {MAX_ACCOUNTS} accounts. Remove one to add another.
        </div>
      ) : (
        <AddAccountForm banks={banks} hasBankList={hasBankList} />
      )}
    </div>
  );
}

function AccountRow({ account }: { account: PayoutAccount }) {
  const [activeState, activeAction, activePending] = useActionState(setActivePayoutAccount, INIT);
  const [removeState, removeAction, removePending] = useActionState(removePayoutAccount, INIT);
  const last4 = account.account_number.slice(-4);

  return (
    <div
      className="panel"
      style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        padding: '12px 14px', margin: 0,
        borderColor: account.is_active ? 'var(--gf-brand)' : undefined,
        background: account.is_active ? 'var(--gf-brand-soft, rgba(99,102,241,0.06))' : undefined,
      }}
    >
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {account.bank_name}
          {account.is_active && (
            <span className="gf-badge gf-badge-success" style={{ fontSize: '0.72rem' }}><Star size={11} strokeWidth={2.4} /> Active</span>
          )}
          {account.verified && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--gf-success)', fontSize: '0.74rem', fontWeight: 600 }}>
              <Check size={12} strokeWidth={2.6} /> Verified
            </span>
          )}
        </div>
        <div style={{ fontSize: '0.84rem', color: 'var(--gf-text-muted)' }}>
          {account.account_name} · ••••{last4}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {account.is_active ? (
          <span style={{ fontSize: '0.8rem', color: 'var(--gf-text-muted)', fontWeight: 600 }}>Receiving payouts</span>
        ) : (
          <form action={activeAction}>
            <input type="hidden" name="account_id" value={account.id} />
            <button type="submit" className="gf-btn gf-btn-secondary gf-btn-sm" disabled={activePending}>
              {activePending ? 'Setting…' : 'Make active'}
            </button>
          </form>
        )}
        <form action={removeAction}>
          <input type="hidden" name="account_id" value={account.id} />
          <button type="submit" className="gf-btn gf-btn-ghost gf-btn-sm" disabled={removePending} title="Remove account" aria-label="Remove account" style={{ color: 'var(--gf-danger)' }}>
            <Trash2 size={15} strokeWidth={2} />
          </button>
        </form>
      </div>
      {(activeState.error || removeState.error) && (
        <div style={{ flexBasis: '100%', color: 'var(--gf-danger)', fontSize: '0.8rem', fontWeight: 600 }}>
          {activeState.error || removeState.error}
        </div>
      )}
    </div>
  );
}

function AddAccountForm({ banks, hasBankList }: { banks: Bank[]; hasBankList: boolean }) {
  const [addState, addAction, addPending] = useActionState(addPayoutAccount, INIT);

  const [bankName, setBankName] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [verified, setVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // Pick by the bank's Paystack code so a valid bank_code is always submitted.
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
  const canSubmit = hasBankList
    ? /^\d{10}$/.test(accountNumber) && /^\d{3,6}$/.test(bankCode) && accountName.trim().length > 0 && !addPending
    : !addPending;

  return (
    <form className="panel" action={addAction}>
      <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Plus size={16} strokeWidth={2.2} /> Add payout account</div>
      <div className="panel-desc">Add your bank to receive member payments directly — no Paystack account needed, just your bank. Verification is optional.</div>

      {hasBankList ? (
        <>
          <input type="hidden" name="bank_name" value={bankName} readOnly />
          <input type="hidden" name="bank_code" value={bankCode} readOnly />
          <input type="hidden" name="account_number" value={accountNumber} readOnly />
          <div className="frow" style={{ marginTop: 12 }}>
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
        // Paystack not configured (no bank list) — manual entry; still saves.
        <>
          <div className="frow" style={{ marginTop: 12 }}>
            <div className="gf-form-group"><label className="gf-form-label">Bank name</label><input className="gf-input" name="bank_name" placeholder="e.g. GTBank" required /></div>
            <div className="gf-form-group"><label className="gf-form-label">Bank code</label><input className="gf-input" name="bank_code" placeholder="e.g. 058" inputMode="numeric" required /></div>
          </div>
          <div className="frow">
            <div className="gf-form-group"><label className="gf-form-label">Account number</label><input className="gf-input" name="account_number" placeholder="10 digits" inputMode="numeric" maxLength={10} required /></div>
            <div className="gf-form-group"><label className="gf-form-label">Account name</label><input className="gf-input" name="account_name" required /></div>
          </div>
        </>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
        <button className="gf-btn gf-btn-primary" type="submit" disabled={!canSubmit}>
          {addPending ? 'Saving…' : 'Add account'}
        </button>
        {addState.ok && <span style={{ color: 'var(--gf-success)', fontSize: '0.84rem', fontWeight: 600 }}>Added ✓</span>}
        {addState.error && <span style={{ color: 'var(--gf-danger)', fontSize: '0.84rem', fontWeight: 600 }}>{addState.error}</span>}
      </div>
    </form>
  );
}
