'use client';

import { useTransition } from 'react';
import { Download } from 'lucide-react';
import { exportMembersCsv } from '@/lib/actions/export-members';
import { useToast } from '@/lib/toast';

// Triggers a browser download of the members CSV. The server action returns
// the raw CSV string; we wrap it in a Blob client-side so the file lands in
// the user's Downloads without round-tripping through a special API route.

export function ExportMembersCsvButton({ slug }: { slug: string }) {
  const [pending, start] = useTransition();
  const toast = useToast();

  function onClick() {
    start(async () => {
      const r = await exportMembersCsv(slug);
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
      // Free the blob URL after the click handler has had a chance to use it.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(`Exported ${r.rows} member${r.rows === 1 ? '' : 's'}`, 'success');
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="gf-btn gf-btn-secondary gf-btn-sm"
      title="Download every member as a CSV"
    >
      <Download size={16} strokeWidth={2} />
      {pending ? 'Preparing…' : 'Export CSV'}
    </button>
  );
}
