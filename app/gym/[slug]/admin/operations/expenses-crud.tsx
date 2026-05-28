'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Receipt } from 'lucide-react';
import { upsertExpense, deleteExpense } from '@/lib/actions/expenses';
import { useToast } from '@/lib/toast';
import { createClient } from '@/lib/supabase/client';
import { fmtDate, fmtNaira } from '@/lib/format';
import { EmptyState } from '@/components/ui/empty-state';

type Item = {
  id: string;
  description: string | null;
  amount: number;
  category: string;
  expense_date: string | null;
  is_recurring: boolean | null;
  recurring_frequency: string | null;
  receipt_url: string | null;
};

const EMPTY: Item = {
  id: '',
  description: '',
  amount: 0,
  category: 'utilities',
  expense_date: new Date().toISOString().split('T')[0],
  is_recurring: false,
  recurring_frequency: null,
  receipt_url: null,
};

const CATEGORIES = ['utilities', 'maintenance', 'supplies', 'salaries', 'rent', 'marketing', 'other'];

export function ExpensesCrud({ slug, gymId, items }: { slug: string; gymId: string; items: Item[] }) {
  const [editing, setEditing] = useState<Item | null>(null);
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const supabase = createClient();

  async function uploadReceipt(file: File): Promise<string | null> {
    setUploading(true);
    try {
      const path = `${gymId}/receipts/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
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
          + Add expense
        </button>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={Receipt} title="No expenses recorded yet" />
      ) : (
        <div className="gf-table-wrap">
          <table className="gf-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
                <th>Description</th>
                <th>Amount</th>
                <th>Receipt</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((x) => (
                <tr key={x.id}>
                  <td>{x.expense_date ? fmtDate(x.expense_date) : '—'}</td>
                  <td>
                    {x.category}
                    {x.is_recurring && <span className="gf-table-meta"> · recurring</span>}
                  </td>
                  <td>{x.description ?? '—'}</td>
                  <td>{fmtNaira(x.amount)}</td>
                  <td>
                    {x.receipt_url ? (
                      <a href={x.receipt_url} className="gf-link" target="_blank" rel="noreferrer">View</a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td style={{ display: 'flex', gap: 4 }}>
                    <button type="button" className="gf-btn gf-btn-ghost gf-btn-sm" onClick={() => setEditing(x)}>Edit</button>
                    <button
                      type="button"
                      className="gf-btn gf-btn-ghost gf-btn-sm"
                      disabled={pending}
                      onClick={() => {
                        if (!confirm('Delete this expense?')) return;
                        start(async () => {
                          const r = await deleteExpense(slug, x.id);
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
          <div className="gf-card" style={{ width: '100%', maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <header className="gf-card-header">
              <h3 className="gf-card-title">{editing.id ? 'Edit expense' : 'Add expense'}</h3>
              <button type="button" className="gf-btn gf-btn-ghost gf-btn-sm" onClick={() => setEditing(null)}>Close</button>
            </header>
            <form
              className="form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                start(async () => {
                  const r = await upsertExpense(slug, fd);
                  if (r.ok) { toast(editing.id ? 'Updated' : 'Saved', 'success'); setEditing(null); router.refresh(); }
                  else toast(r.error ?? 'Failed', 'error');
                });
              }}
            >
              <input type="hidden" name="id" defaultValue={editing.id} />
              <input type="hidden" name="receipt_url" defaultValue={editing.receipt_url ?? ''} id="exp-receipt-url" />

              <div className="gf-form-group">
                <label className="gf-label" htmlFor="exp-date">Date</label>
                <input id="exp-date" name="expense_date" type="date" required className="gf-input" defaultValue={editing.expense_date ?? new Date().toISOString().split('T')[0]} />
              </div>
              <div className="gf-form-group">
                <label className="gf-label" htmlFor="exp-cat">Category</label>
                <select id="exp-cat" name="category" required className="gf-select" defaultValue={editing.category}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="gf-form-group">
                <label className="gf-label" htmlFor="exp-amount">Amount (₦)</label>
                <input id="exp-amount" name="amount" type="number" min="0" step="100" required className="gf-input" defaultValue={editing.amount} />
              </div>
              <div className="gf-form-group" role="group" aria-labelledby="exp-recurring-label">
                <span id="exp-recurring-label" className="gf-label">Recurring?</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    id="exp-is-recurring"
                    type="checkbox"
                    name="is_recurring"
                    defaultChecked={!!editing.is_recurring}
                    aria-label="This expense recurs"
                    className="gf-check"
                  />
                  <select
                    id="exp-freq"
                    name="recurring_frequency"
                    className="gf-select"
                    defaultValue={editing.recurring_frequency ?? 'monthly'}
                    aria-label="Recurrence frequency"
                  >
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
              </div>
              <div className="gf-form-group form-grid-full">
                <label className="gf-label" htmlFor="exp-desc">Description</label>
                <textarea id="exp-desc" name="description" rows={2} className="gf-input" defaultValue={editing.description ?? ''} />
              </div>
              <div className="gf-form-group form-grid-full">
                <label className="gf-label" htmlFor="exp-receipt-file">Receipt photo</label>
                <input
                  id="exp-receipt-file"
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const url = await uploadReceipt(file);
                    if (url) {
                      (document.getElementById('exp-receipt-url') as HTMLInputElement).value = url;
                      toast('Receipt uploaded', 'success');
                    }
                  }}
                />
                {uploading && <p className="gf-form-hint">Uploading…</p>}
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
