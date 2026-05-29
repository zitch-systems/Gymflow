'use client';

import { useTransition } from 'react';
import { Download } from 'lucide-react';
import { exportAuditCsv } from '@/lib/actions/export-audit';
import { useToast } from '@/lib/toast';

// Same browser-download pattern as the members CSV button. Receives the
// current scope + window as props (the page reads them from searchParams and
// passes them in) so the CSV mirrors what's on screen — "export what I see."

type Props = {
  slug: string;
  scopeId: string;
  daysId: string;
};

export function ExportAuditCsvButton({ slug, scopeId, daysId }: Props) {
  const [pending, start] = useTransition();
  const toast = useToast();

  function onClick() {
    start(async () => {
      const r = await exportAuditCsv(slug, scopeId, daysId);
      if (!r.ok) {
        toast(r.error ?? 'Export failed', 'error');
        return;
      }
      const blob = new Blob([r.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = r.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(`Exported ${r.rows} event${r.rows === 1 ? '' : 's'}`, 'success');
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="gf-btn gf-btn-secondary gf-btn-sm"
      title="Download the filtered audit log as a CSV"
    >
      <Download size={16} strokeWidth={2} />
      {pending ? 'Preparing…' : 'Export CSV'}
    </button>
  );
}
