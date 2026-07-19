'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { Save, AlertCircle, Trash2, ImagePlus, X } from 'lucide-react';
import { saveEquipment, deleteEquipment, type FState } from '@/lib/actions/facility';

const INIT: FState = { ok: false, error: null };

type Equipment = {
  id?: string; name?: string | null; category?: string | null; location?: string | null;
  status?: string | null; serial_number?: string | null; vendor?: string | null;
  purchase_date?: string | null; purchase_price?: number | null;
  last_maintenance_date?: string | null; next_maintenance_date?: string | null; maintenance_notes?: string | null;
  photo_url?: string | null;
};

const STATUS = [
  ['active', 'Operational'],
  ['maintenance', 'Needs service'],
  ['retired', 'Out of service'],
  ['lost', 'Lost'],
] as const;

export function EquipmentForm({ equipment: e }: { equipment?: Equipment }) {
  const [state, action, pending] = useActionState(saveEquipment, INIT);
  const [preview, setPreview] = useState<string | null>(e?.photo_url ?? null);
  const [removed, setRemoved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Tracks the blob URL we minted for the local preview (never the server
  // photo_url) so we can revoke it — createObjectURL leaks the blob until then.
  const objUrlRef = useRef<string | null>(null);

  function onPick(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    if (!file) return;
    if (objUrlRef.current) URL.revokeObjectURL(objUrlRef.current); // release the previous preview
    const url = URL.createObjectURL(file);
    objUrlRef.current = url;
    setPreview(url);
    setRemoved(false);
  }
  function onRemove() {
    if (objUrlRef.current) { URL.revokeObjectURL(objUrlRef.current); objUrlRef.current = null; }
    setPreview(null);
    setRemoved(true);
    if (fileRef.current) fileRef.current.value = '';
  }
  // Revoke any outstanding preview blob when the form unmounts.
  useEffect(() => () => { if (objUrlRef.current) URL.revokeObjectURL(objUrlRef.current); }, []);

  return (
    <form action={action} className="addmember">
      {e?.id && <input type="hidden" name="id" value={e.id} />}
      {removed && <input type="hidden" name="remove_photo" value="on" />}

      <div className="eq-photo">
        <div className="eq-photo-thumb">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" />
          ) : (
            <ImagePlus strokeWidth={1.5} />
          )}
        </div>
        <div className="eq-photo-body">
          <label className="gf-btn gf-btn-secondary gf-btn-sm" style={{ cursor: 'pointer' }}>
            <ImagePlus size={15} strokeWidth={2} /> {preview ? 'Change photo' : 'Upload photo'}
            <input ref={fileRef} type="file" name="photo" accept="image/*" onChange={onPick} hidden />
          </label>
          {preview && (
            <button type="button" className="gf-btn gf-btn-ghost gf-btn-sm" onClick={onRemove}>
              <X size={15} strokeWidth={2} /> Remove
            </button>
          )}
          <p className="addmember-note">Optional — PNG, JPG or WebP, up to 2&nbsp;MB.</p>
        </div>
      </div>

      <div className="af-grid">
        <label>Name<input className="gf-input" name="name" defaultValue={e?.name ?? ''} placeholder="e.g. Treadmill #3" required /></label>
        <label>Category<input className="gf-input" name="category" defaultValue={e?.category ?? ''} placeholder="e.g. Cardio" /></label>
        <label>Zone / location<input className="gf-input" name="location" defaultValue={e?.location ?? ''} placeholder="e.g. Cardio floor" /></label>
        <label>Status
          <select className="gf-select" name="status" defaultValue={e?.status ?? 'active'}>
            {STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label>Serial number<input className="gf-input" name="serial_number" defaultValue={e?.serial_number ?? ''} /></label>
        <label>Vendor<input className="gf-input" name="vendor" defaultValue={e?.vendor ?? ''} /></label>
        <label>Purchase date<input className="gf-input" type="date" name="purchase_date" defaultValue={e?.purchase_date ?? ''} /></label>
        <label>Purchase price (₦)<input className="gf-input" type="number" name="purchase_price" min="0" step="1000" defaultValue={e?.purchase_price != null ? String(e.purchase_price) : ''} /></label>
        <label>Last serviced<input className="gf-input" type="date" name="last_maintenance_date" defaultValue={e?.last_maintenance_date ?? ''} /></label>
        <label>Next service due<input className="gf-input" type="date" name="next_maintenance_date" defaultValue={e?.next_maintenance_date ?? ''} /></label>
      </div>
      <label style={{ display: 'block', marginTop: 12 }}>Maintenance notes
        <textarea className="gf-textarea" name="maintenance_notes" defaultValue={e?.maintenance_notes ?? ''} placeholder="Belt worn — replacement ordered…" />
      </label>
      {state.error && <p className="act-fb err"><AlertCircle size={15} strokeWidth={2} /> {state.error}</p>}
      <div className="addmember-actions">
        <button className="gf-btn gf-btn-primary" disabled={pending} type="submit"><Save size={16} strokeWidth={2} /> {pending ? 'Saving…' : (e?.id ? 'Save changes' : 'Add equipment')}</button>
        <Link href="/admin/operations" className="gf-btn gf-btn-secondary">Cancel</Link>
      </div>
    </form>
  );
}

export function DeleteEquipmentButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function onClick() {
    if (!window.confirm('Delete this equipment? This cannot be undone.')) return;
    const fd = new FormData();
    fd.set('id', id);
    start(async () => {
      const r = await deleteEquipment(INIT, fd);
      if (!r.ok) setError(r.error); // success redirects away
    });
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
      <button type="button" className="gf-btn gf-btn-danger gf-btn-sm" onClick={onClick} disabled={pending}>
        <Trash2 size={15} strokeWidth={2} /> {pending ? 'Deleting…' : 'Delete equipment'}
      </button>
      {error && <span style={{ color: 'var(--gf-danger)', fontSize: '0.82rem' }}>{error}</span>}
    </div>
  );
}
