'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createPtPack, setPtPackActive, grantPtPackToMember } from '@/lib/actions/pt-packs';
import { useToast } from '@/lib/toast';

type Option = { user_id: string; label: string | null };
type PackOpt = { id: string; label: string };

export function PtPackForm({ slug, instructors }: { slug: string; instructors: Option[] }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  return (
    <form
      className="form-grid"
      style={{ padding: 18 }}
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        start(async () => {
          const r = await createPtPack(slug, fd);
          if (r.ok) {
            toast('Pack created', 'success');
            form.reset();
            router.refresh();
          } else {
            toast(r.error ?? 'Failed', 'error');
          }
        });
      }}
    >
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="pack-name">Name <span className="req">*</span></label>
        <input id="pack-name" name="name" className="gf-input" required placeholder="10-session PT with Ada" maxLength={120} />
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="pack-instructor">Coach <span className="req">*</span></label>
        <select id="pack-instructor" name="instructor_id" className="gf-input" required defaultValue="">
          <option value="" disabled>Choose a coach…</option>
          {instructors.map((i) => (
            <option key={i.user_id} value={i.user_id}>{i.label ?? i.user_id.slice(0, 8)}</option>
          ))}
        </select>
        {instructors.length === 0 && (
          <p className="gf-form-hint">Invite at least one instructor first under <em>Instructors</em>.</p>
        )}
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="pack-count">Sessions <span className="req">*</span></label>
        <input id="pack-count" name="session_count" type="number" min={1} max={100} required className="gf-input" defaultValue={10} />
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="pack-price">Price (₦) <span className="req">*</span></label>
        <input id="pack-price" name="price" type="number" min={0} step={100} required className="gf-input" defaultValue={50000} />
      </div>
      <div className="form-grid-full" style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="submit" className="gf-btn gf-btn-primary" disabled={pending || instructors.length === 0}>
          {pending ? 'Creating…' : 'Create pack'}
        </button>
      </div>
    </form>
  );
}

export function DeactivateButton({ slug, packId, isActive }: { slug: string; packId: string; isActive: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  return (
    <button
      type="button"
      className="gf-btn gf-btn-ghost gf-btn-sm"
      disabled={pending}
      onClick={() => {
        start(async () => {
          const r = await setPtPackActive(slug, packId, !isActive);
          if (r.ok) {
            toast(isActive ? 'Pack deactivated' : 'Pack activated', 'success');
            router.refresh();
          } else {
            toast(r.error ?? 'Failed', 'error');
          }
        });
      }}
    >
      {pending ? '…' : isActive ? 'Deactivate' : 'Activate'}
    </button>
  );
}

export function GrantPackForm({
  slug,
  packs,
  members,
}: {
  slug: string;
  packs: PackOpt[];
  members: Option[];
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  return (
    <form
      className="form-grid"
      style={{ padding: 18 }}
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        start(async () => {
          const r = await grantPtPackToMember(slug, fd);
          if (r.ok) {
            toast('Pack granted to member', 'success');
            form.reset();
            router.refresh();
          } else {
            toast(r.error ?? 'Failed', 'error');
          }
        });
      }}
    >
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="grant-pack">Pack <span className="req">*</span></label>
        <select id="grant-pack" name="pack_id" className="gf-input" required defaultValue="">
          <option value="" disabled>Choose a pack…</option>
          {packs.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>
      <div className="gf-form-group">
        <label className="gf-label" htmlFor="grant-member">Member <span className="req">*</span></label>
        <select id="grant-member" name="member_id" className="gf-input" required defaultValue="">
          <option value="" disabled>Choose a member…</option>
          {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.label ?? m.user_id.slice(0, 8)}</option>)}
        </select>
      </div>
      <div className="gf-form-group form-grid-full">
        <label className="gf-label" htmlFor="grant-notes">Notes (optional)</label>
        <input id="grant-notes" name="notes" className="gf-input" placeholder="e.g. Paid cash · receipt #4128" maxLength={200} />
      </div>
      <div className="form-grid-full" style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="submit" className="gf-btn gf-btn-primary" disabled={pending || packs.length === 0 || members.length === 0}>
          {pending ? 'Granting…' : 'Grant pack'}
        </button>
      </div>
    </form>
  );
}
