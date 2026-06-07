import { describe, it, expect, vi, beforeEach } from 'vitest';
import './_stub-server-only';

// Config/CRUD actions:
//   - landing.ts         (staff: edit the public landing page fields)
//   - member-instructors.ts (member: cancel / toggle auto-renew on their OWN
//                            instructor subscription)
// Different auth surfaces (requireStaff vs requireMember) but the same family
// of invariants: correct authz, gym-scoped writes, and — for the member
// actions — member_id scoping so one member can't touch another's row.

const { state, requireStaffMock, requireMemberMock, getSessionMock, auditMock } = vi.hoisted(() => {
  type EqCall = { col: string; val: unknown };
  const state: {
    writeError: { message: string } | null;
    inserts: Array<{ table: string; payload: unknown }>;
    updates: Array<{ table: string; payload: Record<string, unknown>; eqs: EqCall[] }>;
    deletes: Array<{ table: string; eqs: EqCall[] }>;
    callOrder: string[];
  } = { writeError: null, inserts: [], updates: [], deletes: [], callOrder: [] };
  type AuditArg = { action: string; table: string; after?: unknown };
  const requireStaffMock = vi.fn(async (slug: string) => { void slug; return { role: 'manager', gym: { id: 'gym-1' } }; });
  const requireMemberMock = vi.fn(async (slug: string) => { void slug; return { user: { id: 'member-1' }, gym: { id: 'gym-1' }, link: {} }; });
  const getSessionMock = vi.fn(async () => ({ id: 'actor-1' }));
  const auditMock = vi.fn(async (args: AuditArg) => { void args; });
  return { state, requireStaffMock, requireMemberMock, getSessionMock, auditMock };
});

// Chain-termination mock: update/delete recorded on await (.then), so eqs is
// the complete filter set.
function makeClient() {
  return {
    from(table: string) {
      const eqs: { col: string; val: unknown }[] = [];
      let recorded = false;
      const record = () => {
        if (recorded) return;
        recorded = true;
        if (builder._mode === 'update') { state.updates.push({ table, payload: builder._payload!, eqs: [...eqs] }); state.callOrder.push(`update:${table}`); }
        if (builder._mode === 'delete') { state.deletes.push({ table, eqs: [...eqs] }); state.callOrder.push(`delete:${table}`); }
      };
      const builder = {
        _mode: 'select' as 'select' | 'insert' | 'update' | 'delete',
        _payload: null as Record<string, unknown> | null,
        select() { return builder; },
        insert(p: unknown) { builder._mode = 'insert'; state.inserts.push({ table, payload: p }); state.callOrder.push(`insert:${table}`); return Promise.resolve({ error: state.writeError }); },
        update(p: Record<string, unknown>) { builder._mode = 'update'; builder._payload = p; return builder; },
        delete() { builder._mode = 'delete'; return builder; },
        eq(col: string, val: unknown) { eqs.push({ col, val }); return builder; },
        then<T>(resolve: (v: { error: { message: string } | null }) => T): T { record(); return resolve({ error: state.writeError }); },
      };
      return builder;
    },
  };
}

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => makeClient() }));
vi.mock('@/lib/auth/gym', () => ({ requireStaff: requireStaffMock, requireMember: requireMemberMock }));
vi.mock('@/lib/auth/dal', () => ({ getSessionUser: getSessionMock }));
vi.mock('@/lib/audit', () => ({ audit: auditMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { saveLandingPage } from '@/lib/actions/landing';
import { cancelInstructorSubscription, setInstructorAutoRenew } from '@/lib/actions/member-instructors';

function fd(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
}

beforeEach(() => {
  state.writeError = null;
  state.inserts = [];
  state.updates = [];
  state.deletes = [];
  state.callOrder = [];
  requireStaffMock.mockClear();
  requireMemberMock.mockClear();
  auditMock.mockClear();
});

describe('saveLandingPage', () => {
  it('requires a staff session', async () => {
    requireStaffMock.mockRejectedValueOnce(new Error('redirect'));
    await expect(saveLandingPage('demo', fd({ tagline: 'Get fit' }))).rejects.toThrow();
    expect(state.updates).toHaveLength(0);
  });

  it('updates the gyms row scoped to the staff-session gym id', async () => {
    const r = await saveLandingPage('demo', fd({ tagline: 'Get fit', landing_enabled: 'on' }));
    expect(r.ok).toBe(true);
    const upd = state.updates.find((u) => u.table === 'gyms')!;
    expect(upd.payload).toMatchObject({ tagline: 'Get fit', landing_enabled: true });
    expect(upd.eqs).toContainEqual({ col: 'id', val: 'gym-1' });
  });

  it('treats an absent landing_enabled checkbox as false', async () => {
    await saveLandingPage('demo', fd({ tagline: 'Get fit' }));
    expect(state.updates.find((u) => u.table === 'gyms')!.payload.landing_enabled).toBe(false);
  });

  it('surfaces a DB error', async () => {
    state.writeError = { message: 'update blocked' };
    const r = await saveLandingPage('demo', fd({ tagline: 'x' }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('update blocked');
  });
});

describe('cancelInstructorSubscription (member)', () => {
  it('requires a member session', async () => {
    requireMemberMock.mockRejectedValueOnce(new Error('redirect'));
    await expect(cancelInstructorSubscription('demo', 'sub-1')).rejects.toThrow();
    expect(state.updates).toHaveLength(0);
  });

  it('cancels + disables auto-renew, scoped to the CALLER\'s subscription (member_id + gym_id — no IDOR)', async () => {
    const r = await cancelInstructorSubscription('demo', 'sub-7');
    expect(r.ok).toBe(true);
    const upd = state.updates.find((u) => u.table === 'instructor_subscriptions')!;
    expect(upd.payload).toMatchObject({ status: 'cancelled', auto_renew: false });
    expect(upd.eqs).toContainEqual({ col: 'id', val: 'sub-7' });
    expect(upd.eqs).toContainEqual({ col: 'member_id', val: 'member-1' });
    expect(upd.eqs).toContainEqual({ col: 'gym_id', val: 'gym-1' });
  });

  it('surfaces a DB error', async () => {
    state.writeError = { message: 'denied' };
    const r = await cancelInstructorSubscription('demo', 'sub-1');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('denied');
  });
});

describe('setInstructorAutoRenew (member)', () => {
  it('toggles auto_renew scoped to the caller\'s subscription (member_id + gym_id)', async () => {
    const r = await setInstructorAutoRenew('demo', 'sub-3', true);
    expect(r.ok).toBe(true);
    const upd = state.updates.find((u) => u.table === 'instructor_subscriptions')!;
    expect(upd.payload).toEqual({ auto_renew: true });
    expect(upd.eqs).toContainEqual({ col: 'id', val: 'sub-3' });
    expect(upd.eqs).toContainEqual({ col: 'member_id', val: 'member-1' });
    expect(upd.eqs).toContainEqual({ col: 'gym_id', val: 'gym-1' });
  });
});
