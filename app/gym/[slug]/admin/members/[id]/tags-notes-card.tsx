'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addMemberTag, removeMemberTag, saveMemberStaffNotes } from '@/lib/actions/member-admin';
import { useToast } from '@/lib/toast';
import { X } from 'lucide-react';

export function TagsAndNotesCard({
  slug,
  memberId,
  initialTags,
  initialNotes,
}: {
  slug: string;
  memberId: string;
  initialTags: string[];
  initialNotes: string | null;
}) {
  const [tags, setTags] = useState<string[]>(initialTags);
  const [notes, setNotes] = useState(initialNotes ?? '');
  const [newTag, setNewTag] = useState('');
  const [pending, start] = useTransition();
  const [savingNotes, startNotes] = useTransition();
  const toast = useToast();
  const router = useRouter();

  function add() {
    const t = newTag.trim();
    if (!t) return;
    if (tags.includes(t)) { setNewTag(''); return; }
    start(async () => {
      const r = await addMemberTag(slug, memberId, t);
      if (r.ok) {
        setTags((prev) => [...prev, t]);
        setNewTag('');
        router.refresh();
      } else {
        toast(r.error ?? 'Failed to add tag', 'error');
      }
    });
  }

  function remove(t: string) {
    start(async () => {
      const r = await removeMemberTag(slug, memberId, t);
      if (r.ok) {
        setTags((prev) => prev.filter((x) => x !== t));
        router.refresh();
      } else {
        toast(r.error ?? 'Failed to remove tag', 'error');
      }
    });
  }

  function saveNotes() {
    startNotes(async () => {
      const r = await saveMemberStaffNotes(slug, memberId, notes);
      if (r.ok) {
        toast('Notes saved', 'success');
        router.refresh();
      } else {
        toast(r.error ?? 'Failed to save notes', 'error');
      }
    });
  }

  return (
    <div style={{ padding: 18, display: 'grid', gap: 18 }}>
      <div>
        <label className="gf-label">Tags</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          {tags.length === 0 && (
            <span style={{ fontSize: 13, color: 'var(--gf-text-muted)' }}>No tags yet — add one below.</span>
          )}
          {tags.map((t) => (
            <span
              key={t}
              className="status-pill"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, paddingRight: 4 }}
            >
              {t}
              <button
                type="button"
                onClick={() => remove(t)}
                disabled={pending}
                aria-label={`Remove tag ${t}`}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 2, display: 'inline-flex' }}
              >
                <X size={12} strokeWidth={2.5} />
              </button>
            </span>
          ))}
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); add(); }}
          style={{ display: 'flex', gap: 6, marginTop: 10 }}
        >
          <input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            className="gf-input"
            placeholder="e.g. VIP, Trial, PT"
            maxLength={30}
            style={{ flex: 1 }}
          />
          <button type="submit" className="gf-btn gf-btn-secondary gf-btn-sm" disabled={pending || !newTag.trim()}>
            {pending ? 'Saving…' : 'Add tag'}
          </button>
        </form>
        <p className="gf-form-hint">Letters, numbers, spaces, underscore, hyphen. Up to 30 chars.</p>
      </div>

      <div>
        <label className="gf-label" htmlFor="staff-notes">Staff notes</label>
        <textarea
          id="staff-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="gf-input"
          rows={4}
          maxLength={4000}
          placeholder="Anything the team should know about this member (preferences, injuries, conversion plan…)"
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
          <p className="gf-form-hint" style={{ margin: 0 }}>
            Visible to staff only — never shown in the member portal. {notes.length}/4000
          </p>
          <button
            type="button"
            className="gf-btn gf-btn-primary gf-btn-sm"
            onClick={saveNotes}
            disabled={savingNotes || notes === (initialNotes ?? '')}
          >
            {savingNotes ? 'Saving…' : 'Save notes'}
          </button>
        </div>
      </div>
    </div>
  );
}
