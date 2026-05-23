'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { inviteInstructor } from '@/lib/actions/instructors';
import { useToast } from '@/lib/toast';

export function InviteInstructorForm({ slug }: { slug: string }) {
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
          const r = await inviteInstructor(slug, fd);
          if (r.ok) {
            toast('Invited — temp password sent', 'success');
            (e.currentTarget as HTMLFormElement).reset();
            router.refresh();
          } else {
            toast(r.error ?? 'Failed', 'error');
          }
        });
      }}
    >
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="full_name">Full name <span className="req">*</span></label>
        <input id="full_name" name="full_name" required className="gf-input" />
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="email">Email <span className="req">*</span></label>
        <input id="email" name="email" type="email" required className="gf-input" />
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="phone">Phone</label>
        <input id="phone" name="phone" type="tel" className="gf-input" />
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="specialisation">Specialisation</label>
        <input id="specialisation" name="specialisation" className="gf-input" placeholder="Strength / HIIT / Yoga / …" />
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="session_rate">Monthly subscription rate (₦)</label>
        <input id="session_rate" name="session_rate" type="number" min="0" step="100" className="gf-input" />
      </div>
      <button type="submit" disabled={pending} className="gf-btn gf-btn-primary form-grid-full">
        {pending ? 'Inviting…' : 'Send invite'}
      </button>
    </form>
  );
}
