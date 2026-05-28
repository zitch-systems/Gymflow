'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateInstructorProfile } from '@/lib/actions/coach';
import { useToast } from '@/lib/toast';
import { createClient } from '@/lib/supabase/client';

type Initial = {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  bio: string | null;
  specialisation: string | null;
  certifications: string | null;
  photo_url: string | null;
};

export function ProfileForm({ userId, slug, initial }: { userId: string; slug: string; initial: Initial }) {
  const [photoUrl, setPhotoUrl] = useState(initial.photo_url ?? '');
  const [uploading, setUploading] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const supabase = createClient();

  async function uploadPhoto(file: File) {
    setUploading(true);
    try {
      const path = `${userId}/avatar-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      const { error } = await supabase.storage.from('gym-assets').upload(path, file, { upsert: true });
      if (error) {
        toast(error.message, 'error');
        return;
      }
      const { data: pub } = supabase.storage.from('gym-assets').getPublicUrl(path);
      const url = pub?.publicUrl ?? '';
      setPhotoUrl(url);
      toast('Photo uploaded', 'success');
    } finally {
      setUploading(false);
    }
  }

  return (
    <form
      className="form-grid"
      style={{ padding: 18 }}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await updateInstructorProfile(slug, fd);
          if (r.ok) {
            toast('Profile saved', 'success');
            router.refresh();
          } else {
            toast(r.error ?? 'Failed', 'error');
          }
        });
      }}
    >
      <div className="gf-form-group form-grid-full">
        <label className="gf-label">Photo</label>
        <input type="hidden" name="photo_url" value={photoUrl} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt="" style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover' }} />
          ) : (
            <div className="gf-avatar gf-avatar-lg" style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)' }}>
              {(initial.full_name ?? initial.email ?? 'I').charAt(0).toUpperCase()}
            </div>
          )}
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadPhoto(f);
            }}
          />
        </div>
        {uploading && <p className="gf-form-hint">Uploading…</p>}
      </div>

      <div className="gf-form-group">
        <label className="gf-label" htmlFor="coach-full-name">Name</label>
        <input id="coach-full-name" className="gf-input" defaultValue={initial.full_name ?? ''} disabled />
        <p className="gf-form-hint">Ask gym admin to change.</p>
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="coach-email">Email</label>
        <input id="coach-email" className="gf-input" defaultValue={initial.email ?? ''} disabled />
      </div>

      <div className="gf-form-group">
        <label className="gf-label" htmlFor="specialisation">Specialisation</label>
        <input id="specialisation" name="specialisation" className="gf-input" defaultValue={initial.specialisation ?? ''} placeholder="Strength · HIIT · Yoga…" />
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="certifications">Certifications</label>
        <input id="certifications" name="certifications" className="gf-input" defaultValue={initial.certifications ?? ''} placeholder="NASM-CPT · ACSM…" />
      </div>
      <div className="gf-form-group form-grid-full">
        <label className="gf-label" htmlFor="bio">Bio</label>
        <textarea id="bio" name="bio" rows={5} className="gf-input" defaultValue={initial.bio ?? ''} placeholder="Tell members about your training style, experience, and what to expect." />
      </div>
      <button type="submit" disabled={pending || uploading} className="gf-btn gf-btn-primary form-grid-full">
        {pending ? 'Saving…' : 'Save profile'}
      </button>
    </form>
  );
}
