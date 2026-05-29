'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateMemberProfile } from '@/lib/actions/member-profile';
import { requestPasswordReset } from '@/lib/auth/actions';
import { useToast } from '@/lib/toast';
import { createClient } from '@/lib/supabase/client';

type Initial = {
  phone: string | null;
  photo_url: string | null;
  notification_email: boolean;
  notification_whatsapp: boolean;
};

export function ProfileForm({ slug, userId, email, displayName, initial }: { slug: string; userId: string; email: string | null; displayName: string; initial: Initial }) {
  const [pending, start] = useTransition();
  const [resetPending, startReset] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const supabase = createClient();
  const [emailOpt, setEmailOpt] = useState(initial.notification_email);
  const [waOpt, setWaOpt] = useState(initial.notification_whatsapp);
  const [photoUrl, setPhotoUrl] = useState(initial.photo_url ?? '');
  const [uploading, setUploading] = useState(false);

  async function uploadPhoto(file: File) {
    // Guard against accidental huge uploads — avatars don't need to be big,
    // and a member on Naija data shouldn't push a 10MB photo.
    if (file.size > 5 * 1024 * 1024) {
      toast('Please choose an image under 5MB', 'warning');
      return;
    }
    setUploading(true);
    try {
      const path = `${userId}/avatar-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      const { error } = await supabase.storage.from('gym-assets').upload(path, file, { upsert: true });
      if (error) {
        toast(error.message, 'error');
        return;
      }
      const { data: pub } = supabase.storage.from('gym-assets').getPublicUrl(path);
      setPhotoUrl(pub?.publicUrl ?? '');
      toast('Photo uploaded — tap Save changes to keep it', 'success');
    } finally {
      setUploading(false);
    }
  }

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
      <div className="gf-form-group form-grid-full">
        <label className="gf-label">Profile photo</label>
        <input type="hidden" name="photo_url" value={photoUrl} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt="" style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--gf-border)' }} />
          ) : (
            <div className="gf-avatar gf-avatar-lg" style={{ width: 72, height: 72, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 28, fontWeight: 700, background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)' }}>
              {(displayName || email || 'M').charAt(0).toUpperCase()}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label className="gf-btn gf-btn-secondary gf-btn-sm" style={{ cursor: uploading ? 'wait' : 'pointer' }}>
              {uploading ? 'Uploading…' : photoUrl ? 'Change photo' : 'Upload photo'}
              <input
                type="file"
                accept="image/*"
                disabled={uploading}
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadPhoto(f);
                }}
              />
            </label>
            {photoUrl && (
              <button
                type="button"
                className="gf-btn gf-btn-ghost gf-btn-sm"
                disabled={uploading}
                onClick={() => { setPhotoUrl(''); toast('Photo removed — tap Save changes to keep it', 'success'); }}
              >
                Remove
              </button>
            )}
          </div>
        </div>
        <p className="gf-form-hint">A square image works best. Max 5MB.</p>
      </div>

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

      <div className="gf-form-group form-grid-full" style={{ borderTop: '1px solid var(--gf-border)', paddingTop: 16, marginTop: 4 }}>
        <span className="gf-label">Security</span>
        <p className="gf-form-hint" style={{ marginTop: 0 }}>
          We&apos;ll email you a secure link to set a new password.
        </p>
        <button
          type="button"
          className="gf-btn gf-btn-secondary gf-btn-sm"
          disabled={resetPending}
          onClick={() => {
            if (!email) {
              toast('No email on file — contact the gym to reset your password', 'warning');
              return;
            }
            startReset(async () => {
              const res = await requestPasswordReset(email, window.location.origin);
              if (res.error) toast(res.error, 'error');
              else toast('Password reset link sent — check your email', 'success');
            });
          }}
        >
          {resetPending ? 'Sending…' : 'Change password'}
        </button>
      </div>
    </form>
  );
}
