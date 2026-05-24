'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveLandingPage } from '@/lib/actions/landing';
import { useToast } from '@/lib/toast';
import { createClient } from '@/lib/supabase/client';

type Initial = {
  tagline?: string | null;
  description?: string | null;
  hero_image_url?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  landing_enabled?: boolean | null;
  landing_content?: string | null;
};

export function LandingForm({ slug, gymId, initial }: { slug: string; gymId: string; initial: Initial }) {
  const [heroUrl, setHeroUrl] = useState(initial.hero_image_url ?? '');
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const supabase = createClient();

  async function uploadHero(file: File) {
    setUploading(true);
    try {
      const path = `${gymId}/landing/hero-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      const { error } = await supabase.storage.from('gym-assets').upload(path, file, { upsert: true });
      if (error) {
        toast(error.message, 'error');
        return;
      }
      const { data: pub } = supabase.storage.from('gym-assets').getPublicUrl(path);
      const url = pub?.publicUrl ?? '';
      setHeroUrl(url);
      toast('Hero image uploaded', 'success');
    } finally {
      setUploading(false);
    }
  }

  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await saveLandingPage(slug, fd);
          if (r.ok) {
            toast('Landing page saved', 'success');
            router.refresh();
          } else {
            toast(r.error ?? 'Failed', 'error');
          }
        });
      }}
    >
      <label className="gf-form-group form-grid-full" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" name="landing_enabled" defaultChecked={initial.landing_enabled !== false} className="gf-check" />
        <span>Landing page visible at slug.gymflow.ng</span>
      </label>

      <div className="gf-form-group">
        <label className="gf-label" htmlFor="tagline">Tagline (small text above name)</label>
        <input id="tagline" name="tagline" className="gf-input" defaultValue={initial.tagline ?? ''} placeholder="Lagos · open 6am – 10pm" />
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="hero_image_url">Hero image URL</label>
        <input id="hero_image_url" name="hero_image_url" className="gf-input" value={heroUrl} onChange={(e) => setHeroUrl(e.target.value)} placeholder="https://…" />
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadHero(f);
          }}
          style={{ marginTop: 8 }}
        />
        {uploading && <p className="gf-form-hint">Uploading…</p>}
        {heroUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={heroUrl} alt="" style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 12, marginTop: 8 }} />
        )}
      </div>

      <div className="gf-form-group form-grid-full">
        <label className="gf-label" htmlFor="description">One-line description</label>
        <input id="description" name="description" className="gf-input" defaultValue={initial.description ?? ''} placeholder="A modern gym in the heart of Lekki" />
      </div>

      <div className="gf-form-group">
        <label className="gf-label" htmlFor="address">Address</label>
        <input id="address" name="address" className="gf-input" defaultValue={initial.address ?? ''} />
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="phone">Phone</label>
        <input id="phone" name="phone" className="gf-input" defaultValue={initial.phone ?? ''} />
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="email">Public email</label>
        <input id="email" name="email" type="email" className="gf-input" defaultValue={initial.email ?? ''} />
      </div>

      <div className="gf-form-group form-grid-full">
        <label className="gf-label" htmlFor="landing_content">Additional content (optional, plain text)</label>
        <textarea id="landing_content" name="landing_content" rows={6} className="gf-input" defaultValue={initial.landing_content ?? ''} placeholder="House rules, what to bring, parking info…" />
      </div>

      <button type="submit" disabled={pending || uploading} className="gf-btn gf-btn-primary form-grid-full">
        {pending ? 'Saving…' : 'Save landing page'}
      </button>
    </form>
  );
}
