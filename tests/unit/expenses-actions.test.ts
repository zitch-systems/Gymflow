import { describe, it, expect, vi, beforeEach } from 'vitest';
import './_stub-server-only';

// lib/actions/expenses.ts — gym expense CRUD, gym-scoped + audited. Same
// create/update-branch-on-id shape as equipment. Invariants locked:
//   - requireStaff authz on both functions
//   - upsertExpense: category required AND amount > 0, both rejected before
//     any write (a 0/negative expense is meaningless and would skew analytics)
//   - create vs update branch on `id` presence; both carry the staff gym_id
//     and filter writes by gym_id (no cross-gym mutation)
//   - update snapshots `before` ahead of the write for a real audit diff
//   - deleteExpense is gym-scoped + before-snapshot
//   - correct audit action string per branch

const { state, requireStaffMock, getSessionMock, auditMock } = vi.hoisted(() => {
  type EqCall = { col: string; val: unknown };
  const state: {
    selectData: Map<string, Array<{ data: unknown; error: { message: string } | null }>>;
    writeError: { message: string } | null;
    inserts: Array<{ table: string; payload: Record<string, unknown> }>;
    updates: Array<{ table: string; payload: Record<string, unknown>; eqs: EqCall[] }>;
    deletes: Array<{ table: string; eqs: EqCall[] }>;
    selects: Array<{ table: string; eqs: EqCall[] }>;
    callOrder: string[];
  } = { selectData: new Map(), writeError: null, inserts: [], updates: [], deletes: [], selects: [], callOrder: [] };
  type AuditArg = { action: string; table: string; recordId?: string | null; before?: Record<string, unknown> | null; after?: Record<string, unknown> | null };
  const requireStaffMock = vi.fn(async (slug: string) => { void slug; return { role: 'manager', gym: { id: 'gym-1' } }; });
  const getSessionMock = vi.fn(async () => ({ id: 'actor-1' }));
  const auditMock = vi.fn(async (args: AuditArg) => { void args; });
  return { state, requireStaffMock, getSessionMock, auditMock };
});

// Chain-termination mock: update/delete writes are recorded when the chain is
// awaited (.then), so the captured eqs set is the COMPLETE filter list
// (id + gym_id), never the partial first .eq(). Same pattern as the equipment
// round.
function makeClient() {
  return {
    from(table: string) {
      const eqs: { col: string; val: unknown }[] = [];
      let recorded = false;
      const recordWrite = () => {
        if (recorded) return;
        recorded = true;
        if (builder._mode === 'update') { state.updates.push({ table, payload: builder._payload!, eqs: [...eqs] }); state.callOrder.push(`update:${table}`); }
        if (builder._mode === 'delete') { state.deletes.push({ table, eqs: [...eqs] }); state.callOrder.push(`delete:${table}`); }
      };
      const builder = {
        _mode: 'select' as 'select' | 'insert' | 'update' | 'delete',
        _payload: null as Record<string, unknown> | null,
        select() { return builder; },
        insert(p: Record<string, unknown>) { builder._mode = 'insert'; builder._payload = p; state.inserts.push({ table, payload: p }); state.callOrder.push(`insert:${table}`); return builder; },
        update(p: Record<string, unknown>) { builder._mode = 'update'; builder._payload = p; return builder; },
        delete() { builder._mode = 'delete'; return builder; },
        eq(col: string, val: unknown) { eqs.push({ col, val }); return builder; },
        maybeSingle(): Promise<{ data: unknown; error: { message: string } | null }> {
          if (builder._mode === 'select') { state.selects.push({ table, eqs: [...eqs] }); state.callOrder.push(`select:${table}`); }
          if (builder._mode === 'insert') return Promise.resolve({ data: { id: 'exp-new' }, error: state.writeError });
          const q = state.selectData.get(table) ?? [];
          const next = q.shift() ?? { data: null, error: null };
          return Promise.resolve({ data: next.data ?? null, error: next.error ?? null });
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

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => makeClient() }));
vi.mock('@/lib/auth/gym', () => ({ requireStaff: requireStaffMock }));
vi.mock('@/lib/auth/dal', () => ({ getSessionUser: getSessionMock }));
vi.mock('@/lib/audit', () => ({ audit: auditMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { upsertExpense, deleteExpense } from '@/lib/actions/expenses';

function fd(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
}

beforeEach(() => {
  state.selectData = new Map();
  state.writeError = null;
  state.inserts = [];
  state.updates = [];
  state.deletes = [];
  state.selects = [];
  state.callOrder = [];
  requireStaffMock.mockClear();
  auditMock.mockClear();
});

describe('upsertExpense — validation + authz', () => {
  it('requires a staff session', async () => {
    requireStaffMock.mockRejectedValueOnce(new Error('redirect'));
    await expect(upsertExpense('demo', fd({ category: 'rent', amount: '50000' }))).rejects.toThrow();
    expect(state.inserts).toHaveLength(0);
  });

  it('rejects a missing category', async () => {
    const r = await upsertExpense('demo', fd({ category: '', amount: '50000' }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Category required/);
    expect(state.inserts).toHaveLength(0);
  });

  it('rejects an amount of zero or less (would skew analytics)', async () => {
    expect((await upsertExpense('demo', fd({ category: 'rent', amount: '0' }))).ok).toBe(false);
    expect((await upsertExpense('demo', fd({ category: 'rent', amount: '-100' }))).ok).toBe(false);
    expect(state.inserts).toHaveLength(0);
  });
});

describe('upsertExpense — create (no id)', () => {
  it('inserts with the staff-session gym_id and audits expense_created', async () => {
    const r = await upsertExpense('demo', fd({ category: 'utilities', amount: '12000', description: 'Power bill' }));
    expect(r.ok).toBe(true);
    const ins = state.inserts.find((i) => i.table === 'expenses')!;
    expect(ins.payload).toMatchObject({ gym_id: 'gym-1', category: 'utilities', amount: 12000, description: 'Power bill' });
    expect(auditMock.mock.calls[0]![0].action).toBe('admin.expense_created');
  });

  it('surfaces a DB error on create and does not audit', async () => {
    state.writeError = { message: 'insert blocked' };
    const r = await upsertExpense('demo', fd({ category: 'rent', amount: '50000' }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('insert blocked');
    expect(auditMock).not.toHaveBeenCalled();
  });
});

describe('upsertExpense — update (id present)', () => {
  it('snapshots before, updates gym-scoped, audits expense_updated with before+after', async () => {
    state.selectData.set('expenses', [{ data: { category: 'rent', amount: 40000 }, error: null }]);
    const r = await upsertExpense('demo', fd({ id: 'exp-1', category: 'rent', amount: '45000' }));
    expect(r.ok).toBe(true);
    expect(state.callOrder.indexOf('select:expenses')).toBeLessThan(state.callOrder.indexOf('update:expenses'));
    const upd = state.updates.find((u) => u.table === 'expenses')!;
    expect(upd.eqs).toContainEqual({ col: 'id', val: 'exp-1' });
    expect(upd.eqs).toContainEqual({ col: 'gym_id', val: 'gym-1' });
    const a = auditMock.mock.calls[0]![0];
    expect(a.action).toBe('admin.expense_updated');
    expect(a.before).toMatchObject({ amount: 40000 });
    expect(a.after).toMatchObject({ amount: 45000 });
  });
});

describe('deleteExpense', () => {
  it('snapshots before deleting, scopes the DELETE by gym_id, audits expense_deleted', async () => {
    state.selectData.set('expenses', [{ data: { category: 'rent', amount: 50000 }, error: null }]);
    const r = await deleteExpense('demo', 'exp-9');
    expect(r.ok).toBe(true);
    expect(state.callOrder.indexOf('select:expenses')).toBeLessThan(state.callOrder.indexOf('delete:expenses'));
    const del = state.deletes.find((d) => d.table === 'expenses')!;
    expect(del.eqs).toContainEqual({ col: 'id', val: 'exp-9' });
    expect(del.eqs).toContainEqual({ col: 'gym_id', val: 'gym-1' });
    expect(auditMock.mock.calls[0]![0].action).toBe('admin.expense_deleted');
  });

  it('surfaces a DB error on delete and does not audit', async () => {
    state.selectData.set('expenses', [{ data: { category: 'rent' }, error: null }]);
    state.writeError = { message: 'delete blocked' };
    const r = await deleteExpense('demo', 'exp-9');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('delete blocked');
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('requires a staff session', async () => {
    requireStaffMock.mockRejectedValueOnce(new Error('redirect'));
    await expect(deleteExpense('demo', 'exp-1')).rejects.toThrow();
    expect(state.deletes).toHaveLength(0);
  });
});
