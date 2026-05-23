'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

export function WalletFilters({
  defaultFrom,
  defaultTo,
  defaultMethod,
  defaultStatus,
}: {
  defaultFrom: string;
  defaultTo: string;
  defaultMethod: string;
  defaultStatus: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [, start] = useTransition();

  function apply(next: { from?: string; to?: string; method?: string; status?: string }) {
    const p = new URLSearchParams(params?.toString() ?? '');
    Object.entries(next).forEach(([k, v]) => {
      if (v) p.set(k, v);
      else p.delete(k);
    });
    start(() => router.replace(`?${p.toString()}`));
  }

  function exportCsv() {
    const table = document.querySelector('.gf-table');
    if (!table) return;
    const rows = Array.from(table.querySelectorAll('tr'));
    const csv = rows
      .map((r) =>
        Array.from(r.querySelectorAll('td,th'))
          .map((c) => `"${(c.textContent ?? '').replace(/"/g, '""').trim()}"`)
          .join(','),
      )
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `payments-${defaultFrom}-to-${defaultTo}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: 16, alignItems: 'end' }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--gf-text-muted)' }}>
        From
        <input
          type="date"
          defaultValue={defaultFrom}
          onChange={(e) => apply({ from: e.target.value })}
          className="gf-input"
          style={{ width: 160 }}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--gf-text-muted)' }}>
        To
        <input
          type="date"
          defaultValue={defaultTo}
          onChange={(e) => apply({ to: e.target.value })}
          className="gf-input"
          style={{ width: 160 }}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--gf-text-muted)' }}>
        Method
        <select
          defaultValue={defaultMethod}
          onChange={(e) => apply({ method: e.target.value })}
          className="gf-select"
          style={{ width: 160 }}
        >
          <option value="">All</option>
          <option value="card">Card</option>
          <option value="card_auto">Card (auto-debit)</option>
          <option value="bank_transfer">Bank transfer</option>
          <option value="cash">Cash</option>
          <option value="pos">POS</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--gf-text-muted)' }}>
        Status
        <select
          defaultValue={defaultStatus}
          onChange={(e) => apply({ status: e.target.value })}
          className="gf-select"
          style={{ width: 160 }}
        >
          <option value="">All</option>
          <option value="successful">Successful</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
        </select>
      </label>
      <div style={{ marginLeft: 'auto' }}>
        <button type="button" className="gf-btn gf-btn-ghost gf-btn-sm" onClick={exportCsv}>
          Export CSV
        </button>
      </div>
    </div>
  );
}
