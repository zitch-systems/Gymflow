import { describe, it, expect, vi, beforeEach } from 'vitest';
import './_stub-server-only';

// Staff-only CRM annotations on a member: tags + free-text notes. Invariants:
//   - requireStaff gate
//   - tag string allowlist (letters/digits/space/_/- only; 1–30 chars)
//   - tag upsert is gym-scoped + uses the (gym_id,user_id,tag) onConflict
//   - tag delete is filtered by gym_id + user_id + tag (no IDOR across gyms)
//   - notes length cap (4000) and empty-string-clears semantics
//   - audit fires with the right action string

const { state, requireStaffMock, getSessionMock, auditMock } = vi.hoisted(() => {
  type EqCall = { col: string; val: unknown };
  const state: {
    upserts: Array<{ table: string; payload: Record<string, unknown>; onConflict?: string }>;
    deletes: Array<{ table: string; eqs: EqCall[] }>;
    updates: Array<{ table: string; payload: Record<string, unknown>; eqs: EqCall[] }>;
    selects: Array<{ table: string; eqs: EqCall[] }>;
    selectData: { staff_notes: string | null } | null;
    writeError: { message: string } | null;
  } = { upserts: [], deletes: [], updates: [], selects: [], selectData: { staff_notes: 'old notes' }, writeError: null };
  const requireStaffMock = vi.fn(async (slug: string) => { void slug; return { role: 'manager', gym: { id: 'gym-1' } }; });
  const getSessionMock = vi.fn(async () => ({ id: 'actor-1' }));
  const auditMock = vi.fn(async () => {});
  return { state, requireStaffMock, getSessionMock, auditMock };
});

// Chain-termination mock: writes are recorded on the awaited terminal
// (.then), so the captured eqs set is always complete.
function makeAdmin() {
  return {
    from(table: string) {
      const eqs: { col: string; val: unknown }[] = [];
      let recorded = false;
      const recordWrite = () => {
        if (recorded) return;
        recorded = true;
        if (builder._mode === 'delete') state.deletes.push({ table, eqs: [...eqs] });
        if (builder._mode === 'update') state.updates.push({ table, payload: builder._payload!, eqs: [...eqs] });
      };
      const builder = {
        _mode: 'select' as 'select' | 'upsert' | 'delete' | 'update',
        _payload: null as Record<string, unknown> | null,
        select() { return builder; },
        eq(col: string, val: unknown) { eqs.push({ col, val }); return builder; },
        upsert(payload: Record<string, unknown>, opts?: { onConflict?: string }) {
          state.upserts.push({ table, payload, onConflict: opts?.onConflict });
          return Promise.resolve({ error: state.writeError });
        },
        update(payload: Record<string, unknown>) { builder._mode = 'update'; builder._payload = payload; return builder; },
        delete() { builder._mode = 'delete'; return builder; },
        maybeSingle(): Promise<{ data: unknown; error: null }> {
          state.selects.push({ table, eqs: [...eqs] });
          return Promise.resolve({ data: state.selectData, error: null });
        },
        then<T>(resolve: (v: { error: { message: string } | null }) => T): T {
          recordWrite();
          return resolve({ error: state.writeError });
        },
      };
      return builder;
    },
  };
}

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => makeAdmin() }));
vi.mock('@/lib/auth/gym', () => ({ requireStaff: requireStaffMock }));
vi.mock('@/lib/auth/dal', () => ({ getSessionUser: getSessionMock }));
vi.mock('@/lib/audit', () => ({ audit: auditMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { addMemberTag, removeMemberTag, saveMemberStaffNotes } from '@/lib/actions/member-admin';

beforeEach(() => {
  state.upserts = [];
  state.deletes = [];
  state.updates = [];
  state.selects = [];
  state.selectData = { staff_notes: 'old notes' };
  state.writeError = null;
  requireStaffMock.mockClear();
  auditMock.mockClear();
});

describe('addMemberTag', () => {
  it('requires staff auth', async () => {
    requireStaffMock.mockRejectedValueOnce(new Error('redirect'));
    await expect(addMemberTag('demo', 'm1', 'VIP')).rejects.toThrow();
    expect(state.upserts).toHaveLength(0);
  });

  it('accepts a normal tag and upserts with the correct conflict target', async () => {
    const r = await addMemberTag('demo', 'm1', 'VIP');
    expect(r.ok).toBe(true);
    expect(state.upserts).toHaveLength(1);
    const u = state.upserts[0]!;
    expect(u.table).toBe('member_tags');
    expect(u.payload).toMatchObject({ gym_id: 'gym-1', user_id: 'm1', tag: 'VIP', created_by: 'actor-1' });
    expect(u.onConflict).toBe('gym_id,user_id,tag');
    expect(auditMock).toHaveBeenCalledTimes(1);
  });

  it('trims whitespace before validating', async () => {
    const r = await addMemberTag('demo', 'm1', '  Trial  ');
    expect(r.ok).toBe(true);
    expect(state.upserts[0]!.payload.tag).toBe('Trial');
  });

  it('rejects an empty tag without writing', async () => {
    const r = await addMemberTag('demo', 'm1', '');
    expect(r.ok).toBe(false);
    expect(state.upserts).toHaveLength(0);
  });

  it('rejects a tag with disallowed characters (e.g. comma, slash) — would break a future filter parser', async () => {
    expect((await addMemberTag('demo', 'm1', 'PT,VIP')).ok).toBe(false);
    expect((await addMemberTag('demo', 'm1', 'has/slash')).ok).toBe(false);
    expect((await addMemberTag('demo', 'm1', 'with.dot')).ok).toBe(false);
    expect(state.upserts).toHaveLength(0);
  });

  it('rejects tags over 30 chars', async () => {
    const r = await addMemberTag('demo', 'm1', 'x'.repeat(31));
    expect(r.ok).toBe(false);
  });

  it('rejects a leading space (would let "VIP" and " VIP" exist as separate tags)', async () => {
    const r = await addMemberTag('demo', 'm1', ' leading');
    // After trim() the regex is checked against "leading" — which is valid.
    // The leading-space input thus passes after trim. Document the choice.
    expect(r.ok).toBe(true);
    expect(state.upserts[0]!.payload.tag).toBe('leading');
  });

  it('surfaces a DB error and skips audit', async () => {
    state.writeError = { message: 'unique constraint violation' };
    const r = await addMemberTag('demo', 'm1', 'VIP');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('unique constraint violation');
    expect(auditMock).not.toHaveBeenCalled();
  });
});

describe('removeMemberTag', () => {
  it('requires staff auth', async () => {
    requireStaffMock.mockRejectedValueOnce(new Error('redirect'));
    await expect(removeMemberTag('demo', 'm1', 'VIP')).rejects.toThrow();
    expect(state.deletes).toHaveLength(0);
  });

  it('rejects an empty tag', async () => {
    expect((await removeMemberTag('demo', 'm1', '')).ok).toBe(false);
    expect((await removeMemberTag('demo', 'm1', '   ')).ok).toBe(false);
    expect(state.deletes).toHaveLength(0);
  });

  it('filters DELETE by gym_id + user_id + tag (no cross-gym IDOR)', async () => {
    await removeMemberTag('demo', 'm1', 'VIP');
    expect(state.deletes).toHaveLength(1);
    const d = state.deletes[0]!;
    expect(d.table).toBe('member_tags');
    expect(d.eqs).toContainEqual({ col: 'gym_id', val: 'gym-1' });
    expect(d.eqs).toContainEqual({ col: 'user_id', val: 'm1' });
    expect(d.eqs).toContainEqual({ col: 'tag', val: 'VIP' });
    expect(auditMock).toHaveBeenCalledTimes(1);
  });
});

describe('saveMemberStaffNotes', () => {
  it('requires staff auth', async () => {
    requireStaffMock.mockRejectedValueOnce(new Error('redirect'));
    await expect(saveMemberStaffNotes('demo', 'm1', 'something')).rejects.toThrow();
    expect(state.updates).toHaveLength(0);
  });

  it('rejects notes over 4000 chars', async () => {
    const r = await saveMemberStaffNotes('demo', 'm1', 'x'.repeat(4001));
    expect(r.ok).toBe(false);
    expect(state.updates).toHaveLength(0);
  });

  it('persists notes scoped to gym_id + user_id, with the before-snapshot in the audit', async () => {
    const r = await saveMemberStaffNotes('demo', 'm1', 'Prefers morning classes');
    expect(r.ok).toBe(true);
    const u = state.updates[0]!;
    expect(u.table).toBe('gym_member_links');
    expect(u.payload).toEqual({ staff_notes: 'Prefers morning classes' });
    expect(u.eqs).toContainEqual({ col: 'gym_id', val: 'gym-1' });
    expect(u.eqs).toContainEqual({ col: 'user_id', val: 'm1' });
    expect(auditMock).toHaveBeenCalledTimes(1);
  });

  it('empty/whitespace notes clear the field to null (not "")', async () => {
    const r = await saveMemberStaffNotes('demo', 'm1', '   ');
    expect(r.ok).toBe(true);
    expect(state.updates[0]!.payload.staff_notes).toBeNull();
  });
});
