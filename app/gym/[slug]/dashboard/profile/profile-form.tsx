'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateMemberProfile } from '@/lib/actions/member-profile';
import { useToast } from '@/lib/toast';

type Initial = {
  phone: string | null;
  notification_email: boolean;
  notification_whatsapp: boolean;
};

export function ProfileForm({ slug, initial }: { slug: string; initial: Initial }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const [emailOpt, setEmailOpt] = useState(initial.notification_email);
  const [waOpt, setWaOpt] = useState(initial.notification_whatsapp);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = await updateMemberProfile(slug, fd);
      if (r.ok) {
        toast('Profile saved', 'success');
        router.refresh();
      } else {
        toast(r.error ?? 'Could not save profile', 'error');
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="form-grid">
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="phone">Phone</label>
        <input
          id="phone"
          name="phone"
          type="tel"
          defaultValue={initial.phone ?? ''}
          className="gf-input"
          placeholder="+234…"
          autoComplete="tel"
        />
        <p className="gf-form-hint">Used for WhatsApp reminders when you opt in. We never share it.</p>
      </div>

      <div className="gf-form-group form-grid-full">
        <span className="gf-label">Notifications</span>
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', padding: '12px 0' }}>
          <input
            type="checkbox"
            name="notification_email"
            checked={emailOpt}
            onChange={(e) => setEmailOpt(e.target.checked)}
            className="gf-check"
            style={{ marginTop: 3 }}
          />
          <span>
            <span style={{ display: 'block', fontWeight: 600 }}>Email reminders</span>
            <span style={{ display: 'block', fontSize: 13, color: 'var(--gf-text-secondary)' }}>
              Get reminders 7 / 3 / 1 days before your membership ends, plus auto-renewal updates.
              Payment receipts always send regardless of this setting.
            </span>
          </span>
        </label>

        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', padding: '4px 0' }}>
          <input
            type="checkbox"
            name="notification_whatsapp"
            checked={waOpt}
            onChange={(e) => setWaOpt(e.target.checked)}
            className="gf-check"
            style={{ marginTop: 3 }}
          />
          <span>
            <span style={{ display: 'block', fontWeight: 600 }}>WhatsApp reminders</span>
            <span style={{ display: 'block', fontSize: 13, color: 'var(--gf-text-secondary)' }}>
              Get the same reminders as a WhatsApp message. Requires your phone number above.
            </span>
          </span>
        </label>
      </div>

      <div className="form-grid-full" style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="submit" className="gf-btn gf-btn-primary" disabled={pending}>
          {pending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
