'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { scheduleSession } from '@/lib/actions/coach';
import { useToast } from '@/lib/toast';

export function ScheduleSessionForm({ slug, eligible }: { slug: string; eligible: { id: string; name: string }[] }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  if (eligible.length === 0) {
    return (
      <div style={{ padding: 18, color: 'var(--gf-text-muted)', fontSize: '0.875rem' }}>
        No active subscribers yet. Members must subscribe to you before you can schedule a 1-on-1.
      </div>
    );
  }

  return (
    <form
      className="form-grid"
      style={{ padding: 18 }}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const form = e.currentTarget;
        start(async () => {
          const r = await scheduleSession(slug, fd);
          if (r.ok) {
            toast('Session scheduled', 'success');
            form.reset();
            router.refresh();
          } else {
            toast(r.error ?? 'Failed', 'error');
          }
        });
      }}
    >
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="member_id">Member <span className="req">*</span></label>
        <select id="member_id" name="member_id" required className="gf-input">
          <option value="">Choose…</option>
          {eligible.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="scheduled_at">When <span className="req">*</span></label>
        <input id="scheduled_at" name="scheduled_at" type="datetime-local" required className="gf-input" />
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="duration_minutes">Duration (min)</label>
        <input id="duration_minutes" name="duration_minutes" type="number" min="15" step="15" defaultValue="60" className="gf-input" />
      </div>
      <div className="gf-form-group form-grid-full">
        <label className="gf-label" htmlFor="notes">Notes</label>
        <input id="notes" name="notes" className="gf-input" placeholder="Focus areas, equipment…" />
      </div>
      <button type="submit" disabled={pending} className="gf-btn gf-btn-primary form-grid-full">
        {pending ? 'Scheduling…' : 'Schedule session'}
      </button>
    </form>
  );
}
