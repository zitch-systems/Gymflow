import { describe, it, expect, vi, beforeEach } from 'vitest';
import './_stub-server-only';

// Membership lifecycle actions (lib/actions/subscription.ts). memberships is
// SELECT-only under RLS so every write goes through the service-role client;
// the invariants worth locking are therefore the in-code authz + scoping that
// stand in for RLS:
//   - member ops (requestPause / cancelAtPeriodEnd) require a session and
//     resolve the membership scoped to member_id + gym_id + status=active, so
//     a member can only touch their OWN active membership
//   - admin ops (approvePause / resumeMembership / extendMembership /
//     cancelMembership) go through requireStaff and filter every write by
//     gym_id, so an admin of gym A can't mutate gym B's membership by id
//   - extendMembership clamps days to 1..365
//   - each path writes an audit_logs row with the right action string

const { state, getSessionMock, getGymMock, requireStaffMock } = vi.hoisted(() => {
  type EqCall = { col: string; val: unknown };
  const state: {
    sessionUser: { id: string; email: string } | null;
    gym: { id: string } | null;
    selectData: Map<string, Array<{ data: unknown; error: { message: string } | null }>>;
    updateError: { message: string } | null;
    selects: Array<{ table: string; eqs: EqCall[] }>;
    updates: Array<{ table: string; payload: Record<string, unknown>; eqs: EqCall[] }>;
    inserts: Array<{ table: string; payload: Record<string, unknown> }>;
  } = {
    sessionUser: null,
    gym: { id: 'gym-1' },
    selectData: new Map(),
    updateError: null,
    selects: [],
    updates: [],
    inserts: [],
  };
  const getSessionMock = vi.fn(async () => state.sessionUser);
  const getGymMock = vi.fn(async (slug: string) => { void slug; return state.gym; });
  const requireStaffMock = vi.fn(async (slug: string) => { void slug; return { role: 'manager', gym: state.gym }; });
  return { state, getSessionMock, getGymMock, requireStaffMock };
});

function makeAdminClient() {
  return {
    from(table: string) {
      const eqs: { col: string; val: unknown }[] = [];
      type B = {
        _mode: 'select' | 'update' | 'insert';
        _payload: Record<string, unknown> | null;
        select: () => B;
        update: (p: Record<string, unknown>) => B;
        insert: (p: Record<string, unknown>) => B;
        eq: (col: string, val: unknown) => B;
        order: () => B;
        limit: () => B;
        maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
        then: <T>(resolve: (v: { error: { message: string } | null }) => T) => T;
      };
      const builder: B = {
        _mode: 'select',
        _payload: null,
        select() { builder._mode = 'select'; return builder; },
        update(p) { builder._mode = 'update'; builder._payload = p; return builder; },
        insert(p) { builder._mode = 'insert'; builder._payload = p; return builder; },
        eq(col, val) { eqs.push({ col, val }); return builder; },
        order() { return builder; },
        limit() { return builder; },
        maybeSingle() {
          state.selects.push({ table, eqs: [...eqs] });
          const q = state.selectData.get(table) ?? [];
          const next = q.shift() ?? { data: null, error: null };
          return Promise.resolve(next);
        },
        then(resolve) {
          // Awaited terminal for update (after .eq) and insert (audit_logs).
          if (builder._mode === 'update') state.updates.push({ table, payload: builder._payload!, eqs: [...eqs] });
          if (builder._mode === 'insert') state.inserts.push({ table, payload: builder._payload! });
          return resolve({ error: builder._mode === 'update' ? state.updateError : null });
        },
      };
      return builder;
    },
  };
}

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => makeAdminClient() }));
vi.mock('@/lib/auth/dal', () => ({ getSessionUser: getSessionMock }));
vi.mock('@/lib/auth/gym', () => ({ getGymBySlug: getGymMock, requireStaff: requireStaffMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import {
  requestPause,
  cancelAtPeriodEnd,
  approvePause,
  resumeMembership,
  extendMembership,
  cancelMembership,
} from '@/lib/actions/subscription';

beforeEach(() => {
  state.sessionUser = { id: 'member-1', email: 'm@example.com' };
  state.gym = { id: 'gym-1' };
  state.selectData = new Map();
  state.updateError = null;
  state.selects = [];
  state.updates = [];
  state.inserts = [];
  getSessionMock.mockClear();
  getGymMock.mockClear();
  requireStaffMock.mockClear();
});

const auditRows = () => state.inserts.filter((i) => i.table === 'audit_logs');

describe('requestPause (member)', () => {
  it('returns an error when not signed in — no DB access', async () => {
    state.sessionUser = null;
    const r = await requestPause('demo', 'travel');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Not signed in/);
    expect(state.selects).toHaveLength(0);
  });

  it('returns an error when the gym slug does not resolve', async () => {
    state.gym = null;
    const r = await requestPause('demo', 'travel');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Gym not found/);
  });

  it('resolves the active membership scoped to the caller (member_id + gym_id + status)', async () => {
    state.selectData.set('memberships', [{ data: { id: 'mem-1' }, error: null }]);
    await requestPause('demo', 'travel');
    const sel = state.selects.find((s) => s.table === 'memberships')!;
    expect(sel.eqs).toContainEqual({ col: 'member_id', val: 'member-1' });
    expect(sel.eqs).toContainEqual({ col: 'gym_id', val: 'gym-1' });
    expect(sel.eqs).toContainEqual({ col: 'status', val: 'active' });
  });

  it('returns an error when the member has no active membership — no write', async () => {
    state.selectData.set('memberships', [{ data: null, error: null }]);
    const r = await requestPause('demo', 'travel');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/No active membership/);
    expect(state.updates).toHaveLength(0);
  });

  it('sets status=pause_requested on the resolved membership and audits', async () => {
    state.selectData.set('memberships', [{ data: { id: 'mem-1' }, error: null }]);
    const r = await requestPause('demo', 'injury recovery');
    expect(r.ok).toBe(true);
    const upd = state.updates.find((u) => u.table === 'memberships')!;
    expect(upd.payload).toMatchObject({ status: 'pause_requested', pause_reason: 'injury recovery' });
    expect(upd.eqs).toContainEqual({ col: 'id', val: 'mem-1' });
    const a = auditRows()[0]!;
    expect(a.payload).toMatchObject({ action: 'member.pause_requested', record_id: 'mem-1' });
  });

  it('stores a null pause_reason when none is given', async () => {
    state.selectData.set('memberships', [{ data: { id: 'mem-1' }, error: null }]);
    await requestPause('demo', '');
    const upd = state.updates.find((u) => u.table === 'memberships')!;
    expect(upd.payload.pause_reason).toBeNull();
  });

  it('surfaces a DB error from the update and does not audit', async () => {
    state.selectData.set('memberships', [{ data: { id: 'mem-1' }, error: null }]);
    state.updateError = { message: 'update blocked' };
    const r = await requestPause('demo', 'travel');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('update blocked');
    expect(auditRows()).toHaveLength(0);
  });
});

describe('cancelAtPeriodEnd (member)', () => {
  it('returns an error when no active membership', async () => {
    state.selectData.set('memberships', [{ data: null, error: null }]);
    const r = await cancelAtPeriodEnd('demo');
    expect(r.ok).toBe(false);
    expect(state.updates).toHaveLength(0);
  });

  it('disables auto-debit + auto-renew on the resolved membership and audits', async () => {
    state.selectData.set('memberships', [{ data: { id: 'mem-2' }, error: null }]);
    const r = await cancelAtPeriodEnd('demo');
    expect(r.ok).toBe(true);
    const upd = state.updates.find((u) => u.table === 'memberships')!;
    expect(upd.payload).toMatchObject({ auto_debit_enabled: false, auto_renew: false });
    expect(upd.eqs).toContainEqual({ col: 'id', val: 'mem-2' });
    expect(auditRows()[0]!.payload).toMatchObject({ action: 'member.cancel_at_period_end' });
  });
});

describe('approvePause (admin)', () => {
  it('delegates authz to requireStaff and scopes the write to gym_id', async () => {
    const r = await approvePause('demo', 'mem-5');
    expect(r.ok).toBe(true);
    expect(requireStaffMock).toHaveBeenCalled();
    const upd = state.updates.find((u) => u.table === 'memberships')!;
    expect(upd.payload).toMatchObject({ status: 'paused' });
    expect(upd.eqs).toContainEqual({ col: 'id', val: 'mem-5' });
    expect(upd.eqs).toContainEqual({ col: 'gym_id', val: 'gym-1' });
    expect(auditRows()[0]!.payload).toMatchObject({ action: 'admin.pause_approved' });
  });
});

describe('resumeMembership (admin)', () => {
  it('returns Not found when the membership is missing/foreign', async () => {
    state.selectData.set('memberships', [{ data: null, error: null }]);
    const r = await resumeMembership('demo', 'foreign');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Not found/);
    expect(state.updates).toHaveLength(0);
  });

  it('credits unused pause days back onto end_date when resuming', async () => {
    // Paused 10 days ago, ending 2026-01-01 → should push end_date out ~10 days.
    const pausedAt = new Date(Date.now() - 10 * 86_400_000).toISOString();
    state.selectData.set('memberships', [{ data: { end_date: '2026-01-01', paused_at: pausedAt }, error: null }]);
    const r = await resumeMembership('demo', 'mem-6');
    expect(r.ok).toBe(true);
    const upd = state.updates.find((u) => u.table === 'memberships')!;
    expect(upd.payload).toMatchObject({ status: 'active', paused_at: null, pause_reason: null });
    expect(upd.payload.end_date).toBe('2026-01-11'); // 2026-01-01 + 10 days
    expect(upd.eqs).toContainEqual({ col: 'gym_id', val: 'gym-1' });
  });
});

describe('extendMembership (admin)', () => {
  it('rejects out-of-range day counts (≤0 or >365) before any write', async () => {
    expect((await extendMembership('demo', 'mem-1', 0)).ok).toBe(false);
    expect((await extendMembership('demo', 'mem-1', 366)).ok).toBe(false);
    expect((await extendMembership('demo', 'mem-1', NaN)).ok).toBe(false);
    expect(state.updates).toHaveLength(0);
  });

  it('adds the days onto the existing end_date and audits', async () => {
    state.selectData.set('memberships', [{ data: { end_date: '2026-03-01' }, error: null }]);
    const r = await extendMembership('demo', 'mem-1', 30);
    expect(r.ok).toBe(true);
    const upd = state.updates.find((u) => u.table === 'memberships')!;
    expect(upd.payload.end_date).toBe('2026-03-31'); // 2026-03-01 + 30
    expect(upd.eqs).toContainEqual({ col: 'gym_id', val: 'gym-1' });
    expect(auditRows()[0]!.payload).toMatchObject({ action: 'admin.extend_membership' });
  });
});

describe('cancelMembership (admin)', () => {
  it('sets status=cancelled, kills auto-renew, scopes to gym_id, and audits', async () => {
    const r = await cancelMembership('demo', 'mem-8');
    expect(r.ok).toBe(true);
    const upd = state.updates.find((u) => u.table === 'memberships')!;
    expect(upd.payload).toMatchObject({ status: 'cancelled', auto_debit_enabled: false, auto_renew: false });
    expect(upd.eqs).toContainEqual({ col: 'id', val: 'mem-8' });
    expect(upd.eqs).toContainEqual({ col: 'gym_id', val: 'gym-1' });
    expect(auditRows()[0]!.payload).toMatchObject({ action: 'admin.cancel_membership' });
  });
});
