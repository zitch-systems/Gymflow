'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Save, AlertCircle } from 'lucide-react';
import { createClass, type CState } from '@/lib/actions/admin-class';

const INIT: CState = { ok: false, error: null };
const DAYS: [string, string][] = [['1', 'Monday'], ['2', 'Tuesday'], ['3', 'Wednesday'], ['4', 'Thursday'], ['5', 'Friday'], ['6', 'Saturday'], ['0', 'Sunday']];

export function ClassForm() {
  const [state, action, pending] = useActionState(createClass, INIT);
  return (
    <form action={action} className="addmember">
      <div className="af-grid">
        <label>Class name<input className="gf-input" name="name" placeholder="e.g. Spin" required /></label>
        <label>Category<input className="gf-input" name="category" placeholder="Cardio" /></label>
        <label>Capacity<input className="gf-input" type="number" name="max_capacity" min="1" placeholder="20" /></label>
        <label>Duration (min)<input className="gf-input" type="number" name="duration_minutes" min="5" placeholder="45" /></label>
        <label>Day<select className="gf-input" name="day_of_week" defaultValue="1">{DAYS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label>Room<input className="gf-input" name="room" placeholder="Studio A" /></label>
        <label>Start time<input className="gf-input" type="time" name="start_time" required /></label>
        <label>End time<input className="gf-input" type="time" name="end_time" required /></label>
      </div>
      {state.error && <p className="act-fb err"><AlertCircle size={15} strokeWidth={2} /> {state.error}</p>}
      <div className="addmember-actions">
        <button className="gf-btn gf-btn-primary" disabled={pending} type="submit"><Save size={16} strokeWidth={2} /> {pending ? 'Creating…' : 'Create class'}</button>
        <Link href="/admin/classes" className="gf-btn gf-btn-secondary">Cancel</Link>
      </div>
    </form>
  );
}
