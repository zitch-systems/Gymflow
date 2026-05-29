'use client';

import { useTransition } from 'react';
import { Download } from 'lucide-react';
import { exportPaymentsCsv } from '@/lib/actions/export-payments';
import { useToast } from '@/lib/toast';

type Props = {
  slug: string;
  from?: string;
  to?: string;
  method?: string;
  status?: string;
};

export function ExportPaymentsCsvButton({ slug, from, to, method, status }: Props) {
  const [pending, start] = useTransition();
  const toast = useToast();

  function onClick() {
    start(async () => {
      const r = await exportPaymentsCsv(slug, { from, to, method, status });
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
      toast(`Exported ${r.rows} payment${r.rows === 1 ? '' : 's'}`, 'success');
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="gf-btn gf-btn-secondary gf-btn-sm"
      title="Download the filtered payments as a CSV"
    >
      <Download size={16} strokeWidth={2} />
      {pending ? 'Preparing…' : 'Export CSV'}
    </button>
  );
}
