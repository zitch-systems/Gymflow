'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { connectPaystackSubaccount, fetchBanks, verifyAccountName } from '@/lib/actions/paystack-subaccount';
import { useToast } from '@/lib/toast';

type Initial = {
  bank_code: string | null;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
};

export function PayoutsForm({ slug, initial }: { slug: string; initial: Initial }) {
  const [banks, setBanks] = useState<{ code: string; name: string }[]>([]);
  const [bankCode, setBankCode] = useState(initial.bank_code ?? '');
  const [accountNumber, setAccountNumber] = useState(initial.account_number ?? '');
  const [accountName, setAccountName] = useState(initial.account_name ?? '');
  const [verifying, setVerifying] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  useEffect(() => {
    fetchBanks().then((r) => {
      if (r.ok && r.banks) setBanks(r.banks);
      else if (r.error) toast(r.error, 'error');
    });
  }, [toast]);

  async function handleVerify() {
    if (!/^\d{10}$/.test(accountNumber)) {
      toast('Account number must be 10 digits', 'warning');
      return;
    }
    if (!bankCode) {
      toast('Choose a bank first', 'warning');
      return;
    }
    setVerifying(true);
    const fd = new FormData();
    fd.set('account_number', accountNumber);
    fd.set('bank_code', bankCode);
    const r = await verifyAccountName(fd);
    setVerifying(false);
    if (r.ok && r.accountName) {
      setAccountName(r.accountName);
      toast('Account verified', 'success');
    } else {
      setAccountName('');
      toast(r.error ?? 'Verification failed', 'error');
    }
  }

  function handleConnect() {
    if (!accountName) {
      toast('Verify the account first', 'warning');
      return;
    }
    const fd = new FormData();
    fd.set('account_number', accountNumber);
    fd.set('bank_code', bankCode);
    fd.set('bank_name', banks.find((b) => b.code === bankCode)?.name ?? '');
    start(async () => {
      const r = await connectPaystackSubaccount(slug, fd);
      if (r.ok) {
        toast('Payouts connected', 'success');
        router.refresh();
      } else {
        toast(r.error ?? 'Failed', 'error');
      }
    });
  }

  return (
    <div className="form-grid">
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="bank_code">Bank <span className="req">*</span></label>
        <select
          id="bank_code"
          value={bankCode}
          onChange={(e) => { setBankCode(e.target.value); setAccountName(''); }}
          className="gf-input"
        >
          <option value="">{banks.length === 0 ? 'Loading…' : 'Choose your bank'}</option>
          {banks.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
        </select>
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="account_number">Account number <span className="req">*</span></label>
        <input
          id="account_number"
          inputMode="numeric"
          pattern="\d{10}"
          maxLength={10}
          value={accountNumber}
          onChange={(e) => { setAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 10)); setAccountName(''); }}
          className="gf-input"
          placeholder="0123456789"
        />
      </div>
      <div className="gf-form-group form-grid-full">
        <label className="gf-label">Account name</label>
        <input className="gf-input" value={accountName} disabled placeholder="Verify to populate" />
      </div>
      <button
        type="button"
        disabled={verifying || !bankCode || accountNumber.length !== 10}
        className="gf-btn gf-btn-outline"
        onClick={handleVerify}
      >
        {verifying ? 'Verifying…' : '1. Verify account'}
      </button>
      <button
        type="button"
        disabled={pending || !accountName}
        className="gf-btn gf-btn-primary"
        onClick={handleConnect}
      >
        {pending ? 'Connecting…' : '2. Connect payouts'}
      </button>
    </div>
  );
}
