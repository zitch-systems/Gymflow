'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClassWithSchedule, deleteClass } from '@/lib/actions/classes';
import { useToast } from '@/lib/toast';

export function ClassCreateForm({ slug }: { slug: string }) {
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
          await createClassWithSchedule(slug, fd);
          (e.currentTarget as HTMLFormElement).reset();
          toast('Class added', 'success');
          router.refresh();
        });
      }}
    >
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="cls-name">
          Name <span className="req">*</span>
        </label>
        <input id="cls-name" name="name" className="gf-input" required placeholder="e.g. HIIT Express" />
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="cls-category">
          Category
        </label>
        <input id="cls-category" name="category" className="gf-input" placeholder="HIIT / Yoga / Strength…" />
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="cls-instructor">
          Instructor
        </label>
        <input id="cls-instructor" name="instructor" className="gf-input" placeholder="Coach name" />
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="cls-level">
          Level
        </label>
        <select id="cls-level" name="level" className="gf-select">
          <option value="">Any</option>
          <option value="beginner">Beginner</option>
          <option value="intermediate">Intermediate</option>
          <option value="advanced">Advanced</option>
        </select>
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="cls-day">
          Day <span className="req">*</span>
        </label>
        <select id="cls-day" name="day_of_week" required className="gf-select">
          <option value="1">Monday</option>
          <option value="2">Tuesday</option>
          <option value="3">Wednesday</option>
          <option value="4">Thursday</option>
          <option value="5">Friday</option>
          <option value="6">Saturday</option>
          <option value="0">Sunday</option>
        </select>
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="cls-room">
          Room
        </label>
        <input id="cls-room" name="room" className="gf-input" placeholder="Studio A" />
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="cls-start">
          Start time <span className="req">*</span>
        </label>
        <input id="cls-start" name="start_time" type="time" required className="gf-input" />
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="cls-end">
          End time <span className="req">*</span>
        </label>
        <input id="cls-end" name="end_time" type="time" required className="gf-input" />
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="cls-duration">
          Duration (min)
        </label>
        <input id="cls-duration" name="duration_minutes" type="number" min="5" defaultValue={60} className="gf-input" />
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="cls-cap">
          Capacity
        </label>
        <input id="cls-cap" name="max_capacity" type="number" min="1" defaultValue={20} className="gf-input" />
      </div>
      <div className="gf-form-group form-grid-full">
        <label className="gf-label" htmlFor="cls-desc">
          Description
        </label>
        <textarea id="cls-desc" name="description" rows={2} className="gf-input" />
      </div>
      <button type="submit" disabled={pending} className="gf-btn gf-btn-primary form-grid-full">
        {pending ? 'Saving…' : 'Add to schedule'}
      </button>
    </form>
  );
}

export function ClassDeleteButton({ slug, classId }: { slug: string; classId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  return (
    <button
      type="button"
      className="gf-btn gf-btn-ghost gf-btn-sm"
      disabled={pending}
      onClick={() => {
        if (!confirm('Delete this class and all its schedule slots?')) return;
        start(async () => {
          await deleteClass(slug, classId);
          toast('Class deleted', 'success');
          router.refresh();
        });
      }}
    >
      {pending ? '…' : 'Delete'}
    </button>
  );
}
