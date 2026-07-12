'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Save, AlertCircle, Trash2 } from 'lucide-react';
import { createClass, updateClass, deleteClass, type CState } from '@/lib/actions/admin-class';

const INIT: CState = { ok: false, error: null };
const DAYS: [string, string][] = [['1', 'Monday'], ['2', 'Tuesday'], ['3', 'Wednesday'], ['4', 'Thursday'], ['5', 'Friday'], ['6', 'Saturday'], ['0', 'Sunday']];

export type ClassFormValues = {
  classId: string;
  scheduleId: string;
  name: string;
  category: string | null;
  max_capacity: number | null;
  duration_minutes: number | null;
  day_of_week: number;
  start_time: string | null;
  end_time: string | null;
  room: string | null;
};

const hm = (t?: string | null) => (t ? String(t).slice(0, 5) : '');

export function ClassForm({ klass }: { klass?: ClassFormValues }) {
  const editing = !!klass;
  const [state, action, pending] = useActionState(editing ? updateClass : createClass, INIT);
  return (
    <>
      <form action={action} className="addmember">
        {editing && <input type="hidden" name="class_id" value={klass.classId} />}
        {editing && <input type="hidden" name="schedule_id" value={klass.scheduleId} />}
        <div className="af-grid">
          <label>Class name<input className="gf-input" name="name" placeholder="e.g. Spin" defaultValue={klass?.name ?? ''} required /></label>
          <label>Category<input className="gf-input" name="category" placeholder="Cardio" defaultValue={klass?.category ?? ''} /></label>
          <label>Capacity<input className="gf-input" type="number" name="max_capacity" min="1" placeholder="20" defaultValue={klass?.max_capacity ?? ''} /></label>
          <label>Duration (min)<input className="gf-input" type="number" name="duration_minutes" min="5" placeholder="45" defaultValue={klass?.duration_minutes ?? ''} /></label>
          {editing
            ? <label>Day<select className="gf-input" name="day_of_week" defaultValue={String(klass.day_of_week ?? 1)}>{DAYS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            : <label>Room<input className="gf-input" name="room" placeholder="Studio A" /></label>}
          {editing && <label>Room<input className="gf-input" name="room" placeholder="Studio A" defaultValue={klass.room ?? ''} /></label>}
          <label>Start time<input className="gf-input" type="time" name="start_time" defaultValue={hm(klass?.start_time)} required /></label>
          <label>End time<input className="gf-input" type="time" name="end_time" defaultValue={hm(klass?.end_time)} required /></label>
        </div>
        {!editing && (
          <fieldset className="class-days">
            <legend>Days <span>— the class runs at the same time on each selected day</span></legend>
            <div className="class-days-grid">
              {DAYS.map(([v, l]) => (
                <label key={v} className="class-day-chip">
                  <input type="checkbox" name={`day_${v}`} defaultChecked={v === '1'} /> {l.slice(0, 3)}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {state.error && <p className="act-fb err"><AlertCircle size={15} strokeWidth={2} /> {state.error}</p>}
        <div className="addmember-actions">
          <button className="gf-btn gf-btn-primary" disabled={pending} type="submit"><Save size={16} strokeWidth={2} /> {pending ? (editing ? 'Saving…' : 'Creating…') : (editing ? 'Save changes' : 'Create class')}</button>
          <Link href="/admin/classes" className="gf-btn gf-btn-secondary">Cancel</Link>
        </div>
      </form>
      {editing && <DeleteClass classId={klass.classId} />}
    </>
  );
}

function DeleteClass({ classId }: { classId: string }) {
  const [state, action, pending] = useActionState(deleteClass, INIT);
  return (
    <form action={action} className="addmember" style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--gf-border)' }}>
      <input type="hidden" name="class_id" value={classId} />
      <p style={{ color: 'var(--gf-text-secondary)', margin: '0 0 10px', fontSize: '0.85rem' }}>Removing this class deletes it and all of its weekly time slots. Existing bookings are detached.</p>
      {state.error && <p className="act-fb err"><AlertCircle size={15} strokeWidth={2} /> {state.error}</p>}
      <button className="gf-btn gf-btn-danger" disabled={pending} type="submit"><Trash2 size={16} strokeWidth={2} /> {pending ? 'Removing…' : 'Delete class'}</button>
    </form>
  );
}
