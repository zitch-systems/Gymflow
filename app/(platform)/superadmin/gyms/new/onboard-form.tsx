'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { platformOnboardGym } from '@/lib/actions/platform';
import { useToast } from '@/lib/toast';

export function OnboardForm() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await platformOnboardGym(fd);
          if (r.ok) {
            toast(`${fd.get('gym_name')} onboarded`, 'success');
            router.push('/superadmin');
          } else {
            setError(r.error);
          }
        });
      }}
    >
      {error && <div className="gf-error show form-grid-full" role="alert">{error}</div>}

      <div className="gf-form-group">
        <label className="gf-label" htmlFor="gym_name">Gym name <span className="req">*</span></label>
        <input id="gym_name" name="gym_name" className="gf-input" required />
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="slug">Subdomain slug <span className="req">*</span></label>
        <input id="slug" name="slug" className="gf-input" required placeholder="powerhouse-lagos" pattern="[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?" />
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="owner_email">Owner email <span className="req">*</span></label>
        <input id="owner_email" name="owner_email" type="email" className="gf-input" required />
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="owner_name">Owner full name <span className="req">*</span></label>
        <input id="owner_name" name="owner_name" className="gf-input" required />
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="owner_phone">Owner phone</label>
        <input id="owner_phone" name="owner_phone" type="tel" className="gf-input" />
      </div>

      <button type="submit" disabled={pending} className="gf-btn gf-btn-primary form-grid-full">
        {pending ? 'Onboarding…' : 'Create gym'}
      </button>
    </form>
  );
}
