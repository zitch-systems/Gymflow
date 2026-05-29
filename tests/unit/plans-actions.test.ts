import { describe, it, expect, vi, beforeEach } from 'vitest';
import './_stub-server-only';

// Plans are the source of truth for membership pricing. fulfilMembershipPurchase
// looks up plan.price and rejects underpayment against it, so a bad write here
// ripples directly into the money flow. These tests lock in:
//   - authz delegated to requireStaff (no plan write proceeds without a staff
//     session for THIS gym; gym scoping is enforced via .eq(gym_id))
//   - createPlan silently no-ops on invalid input — UX hole worth knowing
//     about, but better to lock the current behaviour than let it drift
//   - audit fires on success with the right action string + before/after
//   - delete is scoped to the row's gym_id (no cross-gym IDOR)

type Q = Array<{ data?: unknown; error?: { message: string } | null }>;

const { state, requireStaffMock, getSessionMock, auditMock } = vi.hoisted(() => {
  type EqCall = { col: string; val: unknown };
  const state: {
    perTable: Map<string, Q>;
    inserts: Array<{ table: string; payload: Record<string, unknown> }>;
    updates: Array<{ table: string; payload: Record<string, unknown>; eqs: EqCall[] }>;
    deletes: Array<{ table: string; eqs: EqCall[] }>;
    selects: Array<{ table: string; eqs: EqCall[] }>;
  } = { perTable: new Map(), inserts: [], updates: [], deletes: [], selects: [] };

  type AuditArg = { gymId: string | null; actorId: string | null; action: string; table: string; recordId?: string | null; before?: Record<string, unknown> | null; after?: Record<string, unknown> | null };
  const requireStaffMock = vi.fn(async (slug: string) => { void slug; return { role: 'manager', gym: { id: 'gym-1' } }; });
  const getSessionMock = vi.fn(async () => ({ id: 'actor-1' }));
  const auditMock = vi.fn(async (args: AuditArg) => { void args; });
  return { state, requireStaffMock, getSessionMock, auditMock };
});

function makeClient() {
  return {
    from(table: string) {
      const eqs: { col: string; val: unknown }[] = [];
      type B = {
        _mode: 'select' | 'insert' | 'update' | 'delete';
        _payload: Record<string, unknown> | null;
        select: () => B;
        insert: (p: Record<string, unknown>) => B;
        update: (p: Record<string, unknown>) => B;
        delete: () => B;
        eq: (col: string, val: unknown) => B;
        maybeSingle: () => Promise<{ data: unknown; error: null | { message: string } }>;
        then: <T>(resolve: (v: { data: null; error: null }) => T) => T;
      };
      const builder: B = {
        _mode: 'select',
        _payload: null,
        select() { return builder; },
        insert(p) { builder._mode = 'insert'; builder._payload = p; state.inserts.push({ table, payload: p }); return builder; },
        update(p) { builder._mode = 'update'; builder._payload = p; return builder; },
        delete() { builder._mode = 'delete'; return builder; },
        eq(col, val) { eqs.push({ col, val }); return builder; },
        maybeSingle(): Promise<{ data: unknown; error: null | { message: string } }> {
          if (builder._mode === 'select') state.selects.push({ table, eqs: [...eqs] });
          if (builder._mode === 'insert') {
            return Promise.resolve({ data: { id: 'new-row-1' }, error: null });
          }
          const q = state.perTable.get(table) ?? [];
          const next = q.shift() ?? { data: null, error: null };
          // The queue carries optional fields; normalise to the strict shape
          // maybeSingle's return type expects.
          return Promise.resolve({ data: next.data ?? null, error: next.error ?? null });
        },
        then(resolve) {
          if (builder._mode === 'update') state.updates.push({ table, payload: builder._payload!, eqs: [...eqs] });
          if (builder._mode === 'delete') state.deletes.push({ table, eqs: [...eqs] });
          return resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  };
}

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => makeClient() }));
vi.mock('@/lib/auth/gym', () => ({ requireStaff: requireStaffMock }));
vi.mock('@/lib/auth/dal', () => ({ getSessionUser: getSessionMock }));
vi.mock('@/lib/audit', () => ({ audit: auditMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { createPlan, updatePlan, deletePlan } from '@/lib/actions/plans';

function fd(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
}

beforeEach(() => {
  state.perTable = new Map();
  state.inserts = [];
  state.updates = [];
  state.deletes = [];
  state.selects = [];
  requireStaffMock.mockClear();
  auditMock.mockClear();
});

describe('createPlan', () => {
  it('requires a staff session before any DB write (authz delegated)', async () => {
    requireStaffMock.mockRejectedValueOnce(new Error('redirect'));
    await expect(createPlan('demo', fd({ name: 'Gold', price: '15000', duration_months: '1' }))).rejects.toThrow();
    expect(state.inserts).toHaveLength(0);
  });

  it('silently no-ops on missing name (current behaviour — locked here intentionally)', async () => {
    await createPlan('demo', fd({ name: '', price: '15000', duration_months: '1' }));
    expect(state.inserts).toHaveLength(0);
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('silently no-ops on price ≤ 0 — this is the load-bearing guard against price:0 plans', async () => {
    await createPlan('demo', fd({ name: 'Free', price: '0', duration_months: '1' }));
    expect(state.inserts).toHaveLength(0);
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('silently no-ops on duration_months ≤ 0', async () => {
    await createPlan('demo', fd({ name: 'Weird', price: '5000', duration_months: '0' }));
    expect(state.inserts).toHaveLength(0);
  });

  it('on valid input inserts with the staff-session gym_id (not anything from the client)', async () => {
    await createPlan('demo', fd({ name: 'Gold', price: '15000', duration_months: '1', description: 'Premium', is_active: 'on' }));
    expect(state.inserts).toHaveLength(1);
    const ins = state.inserts[0]!;
    expect(ins.table).toBe('membership_plans');
    expect(ins.payload).toMatchObject({
      gym_id: 'gym-1', // from requireStaff, NOT from the form
      name: 'Gold',
      price: 15000,
      duration_months: 1,
      description: 'Premium',
      is_active: true,
      currency: 'NGN',
    });
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMock.mock.calls[0]![0].action).toBe('admin.plan_created');
  });

  it('treats the absence of is_active as false (HTML checkbox convention)', async () => {
    await createPlan('demo', fd({ name: 'Hidden', price: '5000', duration_months: '1' }));
    expect(state.inserts[0]!.payload.is_active).toBe(false);
  });
});

describe('updatePlan', () => {
  it('snapshots BEFORE the update so the audit diff is correct', async () => {
    state.perTable.set('membership_plans', [
      { data: { name: 'Old', price: 5000, duration_months: 1, description: null, is_active: true }, error: null },
    ]);
    await updatePlan('demo', 'plan-1', fd({ name: 'New', price: '7500', duration_months: '1', is_active: 'on' }));
    // .select before .update — verified by call order (select push first, update second)
    expect(state.selects[0]!.table).toBe('membership_plans');
    expect(state.updates[0]!.table).toBe('membership_plans');
    const auditCall = auditMock.mock.calls[0]![0];
    expect(auditCall.action).toBe('admin.plan_updated');
    expect(auditCall.before).toMatchObject({ name: 'Old', price: 5000 });
    expect(auditCall.after).toMatchObject({ name: 'New', price: 7500 });
  });

  it('scopes the UPDATE to the row\'s gym_id (no cross-gym IDOR)', async () => {
    state.perTable.set('membership_plans', [{ data: null, error: null }]); // before snapshot
    await updatePlan('demo', 'foreign-plan-id', fd({ name: 'x', price: '1000', duration_months: '1' }));
    const upd = state.updates[0]!;
    // The action must filter by BOTH id and gym_id, so passing an id from
    // another gym can't mutate it.
    expect(upd.eqs).toContainEqual({ col: 'id', val: 'foreign-plan-id' });
    expect(upd.eqs).toContainEqual({ col: 'gym_id', val: 'gym-1' });
  });
});

describe('deletePlan', () => {
  it('scopes the DELETE to the row\'s gym_id (no cross-gym IDOR)', async () => {
    state.perTable.set('membership_plans', [
      { data: { name: 'Old', price: 5000, duration_months: 1 }, error: null },
    ]);
    await deletePlan('demo', 'foreign-plan-id');
    const del = state.deletes[0]!;
    expect(del.eqs).toContainEqual({ col: 'id', val: 'foreign-plan-id' });
    expect(del.eqs).toContainEqual({ col: 'gym_id', val: 'gym-1' });
  });

  it('snapshots BEFORE deleting so the audit row preserves what was lost', async () => {
    state.perTable.set('membership_plans', [
      { data: { name: 'Bronze', price: 3000, duration_months: 1 }, error: null },
    ]);
    await deletePlan('demo', 'plan-99');
    const auditCall = auditMock.mock.calls[0]![0];
    expect(auditCall.action).toBe('admin.plan_deleted');
    expect(auditCall.before).toMatchObject({ name: 'Bronze', price: 3000 });
    expect(auditCall.recordId).toBe('plan-99');
  });
});
