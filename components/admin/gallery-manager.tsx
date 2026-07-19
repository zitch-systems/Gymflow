'use client';

import { useActionState, useRef, useState, useTransition } from 'react';
import Image from 'next/image';
import { ImagePlus, Trash2, AlertCircle } from 'lucide-react';
import { uploadGymPhotos, removeGymPhoto, type GymSaveState } from '@/lib/actions/gym';

const INIT: GymSaveState = { ok: false, error: null };

// Gym photo gallery — multi-file upload + per-photo remove. Photos show in a
// grid on the gym's public landing page. Owner/manager (server enforces).
export function GalleryManager({ photos }: { photos: string[] }) {
  const [upState, upAction, upPending] = useActionState(uploadGymPhotos, INIT);
  const [removing, startRemove] = useTransition();
  const [removeErr, setRemoveErr] = useState<string | null>(null);
  const [busyUrl, setBusyUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function remove(url: string) {
    setRemoveErr(null); setBusyUrl(url);
    const fd = new FormData(); fd.set('url', url);
    startRemove(async () => { const r = await removeGymPhoto(INIT, fd); if (!r.ok) setRemoveErr(r.error); setBusyUrl(null); });
  }

  return (
    <div className="panel">
      <div className="panel-title">Photos</div>
      <div className="panel-desc">Show your space on your public page — up to 12 images (JPG/PNG/WebP, 3&nbsp;MB each).</div>

      {photos.length > 0 && (
        <div className="gallery-edit">
          {photos.map((url) => (
            <div className="gallery-edit-item" key={url}>
              {/* .gallery-edit-item is a responsive grid cell (position:relative,
                  aspect-ratio:4/3, auto-fill columns), not a fixed pixel box, so
                  `fill` is used instead of static width/height. */}
              <Image src={url} alt="" fill sizes="(max-width: 860px) 45vw, 160px" />
              <button type="button" className="gallery-del" onClick={() => remove(url)} disabled={removing && busyUrl === url} aria-label="Remove photo">
                <Trash2 size={14} strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      )}
      {removeErr && <p className="act-fb err" style={{ marginTop: 10 }}><AlertCircle size={15} strokeWidth={2} /> {removeErr}</p>}

      <form action={upAction} style={{ marginTop: 14 }}>
        <label className="gf-btn gf-btn-secondary gf-btn-sm" style={{ cursor: 'pointer' }}>
          <ImagePlus size={15} strokeWidth={2} /> Choose photos
          <input ref={fileRef} type="file" name="photos" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files?.length) e.currentTarget.form?.requestSubmit(); }} />
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
          {upPending && <span style={{ color: 'var(--gf-text-secondary)', fontSize: '0.84rem' }}>Uploading…</span>}
          {upState.ok && <span style={{ color: 'var(--gf-success)', fontSize: '0.84rem', fontWeight: 600 }}>Added ✓</span>}
          {upState.error && <span style={{ color: 'var(--gf-danger)', fontSize: '0.84rem', fontWeight: 600 }}>{upState.error}</span>}
        </div>
      </form>
    </div>
  );
}
