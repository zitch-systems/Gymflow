'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Dumbbell } from 'lucide-react';
import { upsertEquipment, deleteEquipment } from '@/lib/actions/equipment';
import { useToast } from '@/lib/toast';
import { createClient } from '@/lib/supabase/client';
import { fmtDate } from '@/lib/format';
import { EmptyState } from '@/components/ui/empty-state';

type Item = {
  id: string;
  name: string;
  category: string | null;
  status: string | null;
  purchase_date: string | null;
  purchase_price: number | null;
  last_maintenance_date: string | null;
  next_maintenance_date: string | null;
  photo_url: string | null;
  location: string | null;
  maintenance_notes: string | null;
};

const EMPTY: Item = {
  id: '',
  name: '',
  category: '',
  status: 'active',
  purchase_date: null,
  purchase_price: null,
  last_maintenance_date: null,
  next_maintenance_date: null,
  photo_url: null,
  location: null,
  maintenance_notes: null,
};

export function EquipmentCrud({ slug, gymId, items }: { slug: string; gymId: string; items: Item[] }) {
  const [editing, setEditing] = useState<Item | null>(null);
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const supabase = createClient();

  async function uploadPhoto(file: File): Promise<string | null> {
    setUploading(true);
    try {
      const path = `${gymId}/equipment/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      const { error } = await supabase.storage.from('gym-assets').upload(path, file, { upsert: true });
      if (error) {
        toast(error.message, 'error');
        return null;
      }
      const { data: pub } = supabase.storage.from('gym-assets').getPublicUrl(path);
      return pub?.publicUrl ?? null;
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <div style={{ padding: 16 }}>
        <button type="button" className="gf-btn gf-btn-primary gf-btn-sm" onClick={() => setEditing(EMPTY)}>
          + Add equipment
        </button>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={Dumbbell} title="No equipment tracked yet" />
      ) : (
        <div className="gf-table-wrap">
          <table className="gf-table">
            <thead>
              <tr>
                <th>Photo</th>
                <th>Name</th>
                <th>Category</th>
                <th>Status</th>
                <th>Next maintenance</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id}>
                  <td>
                    {e.photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={e.photo_url} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 8 }} />
                    ) : (
                      <div style={{ width: 48, height: 48, background: 'var(--gf-elevated)', borderRadius: 8 }} />
                    )}
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{e.name}</div>
                    <div className="gf-table-meta">{e.location ?? '—'}</div>
                  </td>
                  <td>{e.category ?? '—'}</td>
                  <td>
                    <span className={`status-pill ${e.status === 'active' ? 'on' : e.status === 'maintenance' ? '' : 'off'}`}>{e.status ?? 'unknown'}</span>
                  </td>
                  <td>{e.next_maintenance_date ? fmtDate(e.next_maintenance_date) : '—'}</td>
                  <td style={{ display: 'flex', gap: 4 }}>
                    <button type="button" className="gf-btn gf-btn-ghost gf-btn-sm" onClick={() => setEditing(e)}>Edit</button>
                    <button
                      type="button"
                      className="gf-btn gf-btn-ghost gf-btn-sm"
                      disabled={pending}
                      onClick={() => {
                        if (!confirm(`Delete ${e.name}?`)) return;
                        start(async () => {
                          const r = await deleteEquipment(slug, e.id);
                          if (r.ok) { toast('Deleted', 'success'); router.refresh(); }
                          else toast(r.error ?? 'Failed', 'error');
                        });
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="gf-modal-bg active" style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', zIndex: 200, padding: 16 }} onClick={() => setEditing(null)}>
          <div className="gf-card" style={{ width: '100%', maxWidth: 540, maxHeight: '85vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <header className="gf-card-header">
              <h3 className="gf-card-title">{editing.id ? 'Edit equipment' : 'Add equipment'}</h3>
              <button type="button" className="gf-btn gf-btn-ghost gf-btn-sm" onClick={() => setEditing(null)}>Close</button>
            </header>
            <form
              className="form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                start(async () => {
                  const r = await upsertEquipment(slug, fd);
                  if (r.ok) { toast(editing.id ? 'Updated' : 'Added', 'success'); setEditing(null); router.refresh(); }
                  else toast(r.error ?? 'Failed', 'error');
                });
              }}
            >
              <input type="hidden" name="id" defaultValue={editing.id} />
              <input type="hidden" name="photo_url" defaultValue={editing.photo_url ?? ''} id="eq-photo-url" />

              <div className="gf-form-group form-grid-full">
                <label className="gf-label">Photo</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const url = await uploadPhoto(file);
                    if (url) {
                      (document.getElementById('eq-photo-url') as HTMLInputElement).value = url;
                      toast('Photo uploaded', 'success');
                    }
                  }}
                />
                {uploading && <p className="gf-form-hint">Uploading…</p>}
              </div>

              <div className="gf-form-group">
                <label className="gf-label" htmlFor="eq-name">Name <span className="req">*</span></label>
                <input id="eq-name" name="name" required className="gf-input" defaultValue={editing.name} />
              </div>
              <div className="gf-form-group">
                <label className="gf-label" htmlFor="eq-category">Category</label>
                <input id="eq-category" name="category" className="gf-input" defaultValue={editing.category ?? ''} placeholder="Cardio / Free weights / …" />
              </div>
              <div className="gf-form-group">
                <label className="gf-label" htmlFor="eq-status">Status</label>
                <select id="eq-status" name="status" className="gf-select" defaultValue={editing.status ?? 'active'}>
                  <option value="active">Active (in service)</option>
                  <option value="maintenance">Under maintenance</option>
                  <option value="retired">Retired</option>
                  <option value="lost">Lost / stolen</option>
                </select>
              </div>
              <div className="gf-form-group">
                <label className="gf-label" htmlFor="eq-location">Location</label>
                <input id="eq-location" name="location" className="gf-input" defaultValue={editing.location ?? ''} placeholder="Main floor / Studio A …" />
              </div>
              <div className="gf-form-group">
                <label className="gf-label" htmlFor="eq-purchase-date">Purchase date</label>
                <input id="eq-purchase-date" name="purchase_date" type="date" className="gf-input" defaultValue={editing.purchase_date ?? ''} />
              </div>
              <div className="gf-form-group">
                <label className="gf-label" htmlFor="eq-purchase-price">Purchase price (₦)</label>
                <input id="eq-purchase-price" name="purchase_price" type="number" min="0" step="100" className="gf-input" defaultValue={editing.purchase_price ?? ''} />
              </div>
              <div className="gf-form-group">
                <label className="gf-label" htmlFor="eq-next-maintenance">Next maintenance</label>
                <input id="eq-next-maintenance" name="next_maintenance_date" type="date" className="gf-input" defaultValue={editing.next_maintenance_date ?? ''} />
              </div>
              <div className="gf-form-group form-grid-full">
                <label className="gf-label" htmlFor="eq-notes">Notes</label>
                <textarea id="eq-notes" name="maintenance_notes" rows={2} className="gf-input" defaultValue={editing.maintenance_notes ?? ''} />
              </div>

              <button type="submit" disabled={pending || uploading} className="gf-btn gf-btn-primary form-grid-full">
                {pending ? 'Saving…' : 'Save'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
