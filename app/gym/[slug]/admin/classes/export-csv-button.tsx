'use client';

import { useTransition } from 'react';
import { Download } from 'lucide-react';
import { exportAttendanceCsv } from '@/lib/actions/export-attendance';
import { useToast } from '@/lib/toast';

type Props = {
  slug: string;
  from?: string;
  to?: string;
  classId?: string;
  status?: string;
};

export function ExportAttendanceCsvButton({ slug, from, to, classId, status }: Props) {
  const [pending, start] = useTransition();
  const toast = useToast();

  function onClick() {
    start(async () => {
      const r = await exportAttendanceCsv(slug, { from, to, class_id: classId, status });
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
      toast(`Exported ${r.rows} booking${r.rows === 1 ? '' : 's'}`, 'success');
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="gf-btn gf-btn-secondary gf-btn-sm"
      title="Download class attendance as a CSV"
    >
      <Download size={16} strokeWidth={2} />
      {pending ? 'Preparing…' : 'Export CSV'}
    </button>
  );
}
