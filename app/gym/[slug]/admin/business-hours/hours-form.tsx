'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { upsertBusinessHours } from '@/lib/actions/business-hours';
import { useToast } from '@/lib/toast';

type Row = { dow: number; label: string; open: string; close: string; closed: boolean };

export function BusinessHoursForm({ slug, rows }: { slug: string; rows: Row[] }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          await upsertBusinessHours(slug, fd);
          toast('Hours saved', 'success');
          router.refresh();
        });
      }}
    >
      <table className="gf-table form-grid-full">
        <thead>
          <tr>
            <th>Day</th>
            <th>Open</th>
            <th>Close</th>
            <th>Closed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.dow}>
              <td style={{ fontWeight: 600 }}>{r.label}</td>
              <td>
                <input
                  type="time"
                  name={`open_${r.dow}`}
                  defaultValue={r.open}
                  aria-label={`${r.label} opening time`}
                  className="gf-input"
                  style={{ maxWidth: 130 }}
                />
              </td>
              <td>
                <input
                  type="time"
                  name={`close_${r.dow}`}
                  defaultValue={r.close}
                  aria-label={`${r.label} closing time`}
                  className="gf-input"
                  style={{ maxWidth: 130 }}
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  name={`closed_${r.dow}`}
                  defaultChecked={r.closed}
                  aria-label={`${r.label} closed all day`}
                  className="gf-check"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="submit" disabled={pending} className="gf-btn gf-btn-primary">
        {pending ? 'Saving…' : 'Save hours'}
      </button>
    </form>
  );
}
