import { describe, it, expect, vi, beforeEach } from 'vitest';
import './_stub-server-only';

// lib/actions/equipment.ts — gym inventory CRUD + maintenance logging.
// Gym-scoped, audited. Invariants locked:
//   - requireStaff authz on all three functions
//   - upsertEquipment branches create vs update on the presence of `id`;
//     name is required; both branches carry the staff-session gym_id and
//     filter writes by gym_id (no cross-gym mutation)
//   - update snapshots `before` ahead of the write so the audit diff is real
//   - deleteEquipment is gym-scoped and snapshots before deleting
//   - recordMaintenance inserts a maintenance row AND updates the equipment's
//     maintenance dates, both gym-scoped
//   - the right audit action string per branch

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

function makeClient() {
  return {
    from(table: string) {
      const eqs: { col: string; val: unknown }[] = [];
      let recorded = false;
      // Record update/delete writes exactly once, at the moment the chain is
      // terminated (awaited via .then, or via .maybeSingle). By then ALL .eq()
      // filters have been applied, so eqs is the complete set.
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
          if (builder._mode === 'insert') return Promise.resolve({ data: { id: 'eq-new' }, error: state.writeError });
          const q = state.selectData.get(table) ?? [];
          const next = q.shift() ?? { data: null, error: null };
          return Promise.resolve({ data: next.data ?? null, error: next.error ?? null });
        },
        // Terminal await for update/delete chains (and bare insert without select).
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

import { upsertEquipment, deleteEquipment, recordMaintenance } from '@/lib/actions/equipment';

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

describe('upsertEquipment — validation + authz', () => {
  it('requires a staff session', async () => {
    requireStaffMock.mockRejectedValueOnce(new Error('redirect'));
    await expect(upsertEquipment('demo', fd({ name: 'Treadmill' }))).rejects.toThrow();
    expect(state.inserts).toHaveLength(0);
  });

  it('rejects a missing name', async () => {
    const r = await upsertEquipment('demo', fd({ name: '' }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Name required/);
    expect(state.inserts).toHaveLength(0);
  });
});

describe('upsertEquipment — create (no id)', () => {
  it('inserts with the staff-session gym_id and audits equipment_created', async () => {
    const r = await upsertEquipment('demo', fd({ name: 'Rower', category: 'cardio', status: 'available' }));
    expect(r.ok).toBe(true);
    const ins = state.inserts.find((i) => i.table === 'equipment')!;
    expect(ins.payload).toMatchObject({ gym_id: 'gym-1', name: 'Rower', category: 'cardio', status: 'available' });
    expect(auditMock.mock.calls[0]![0].action).toBe('admin.equipment_created');
  });

  it('surfaces a DB error on create and does not audit', async () => {
    state.writeError = { message: 'insert blocked' };
    const r = await upsertEquipment('demo', fd({ name: 'Rower' }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('insert blocked');
    expect(auditMock).not.toHaveBeenCalled();
  });
});

describe('upsertEquipment — update (id present)', () => {
  it('snapshots before, updates gym-scoped, audits equipment_updated with before+after', async () => {
    state.selectData.set('equipment', [{ data: { name: 'Old', status: 'available' }, error: null }]);
    const r = await upsertEquipment('demo', fd({ id: 'eq-1', name: 'New', status: 'out_of_service' }));
    expect(r.ok).toBe(true);
    // select (snapshot) precedes update
    expect(state.callOrder.indexOf('select:equipment')).toBeLessThan(state.callOrder.indexOf('update:equipment'));
    const upd = state.updates.find((u) => u.table === 'equipment')!;
    expect(upd.eqs).toContainEqual({ col: 'id', val: 'eq-1' });
    expect(upd.eqs).toContainEqual({ col: 'gym_id', val: 'gym-1' });
    const a = auditMock.mock.calls[0]![0];
    expect(a.action).toBe('admin.equipment_updated');
    expect(a.before).toMatchObject({ name: 'Old' });
    expect(a.after).toMatchObject({ name: 'New', status: 'out_of_service' });
  });
});

describe('deleteEquipment', () => {
  it('snapshots before deleting, scopes the DELETE by gym_id, audits equipment_deleted', async () => {
    state.selectData.set('equipment', [{ data: { name: 'Bench', status: 'available' }, error: null }]);
    const r = await deleteEquipment('demo', 'eq-9');
    expect(r.ok).toBe(true);
    expect(state.callOrder.indexOf('select:equipment')).toBeLessThan(state.callOrder.indexOf('delete:equipment'));
    const del = state.deletes.find((d) => d.table === 'equipment')!;
    expect(del.eqs).toContainEqual({ col: 'id', val: 'eq-9' });
    expect(del.eqs).toContainEqual({ col: 'gym_id', val: 'gym-1' });
    const a = auditMock.mock.calls[0]![0];
    expect(a.action).toBe('admin.equipment_deleted');
    expect(a.before).toMatchObject({ name: 'Bench' });
  });

  it('surfaces a DB error on delete and does not audit', async () => {
    state.selectData.set('equipment', [{ data: { name: 'Bench' }, error: null }]);
    state.writeError = { message: 'delete blocked' };
    const r = await deleteEquipment('demo', 'eq-9');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('delete blocked');
    expect(auditMock).not.toHaveBeenCalled();
  });
});

describe('recordMaintenance', () => {
  it('inserts a maintenance row AND updates the equipment dates, both gym-scoped', async () => {
    const r = await recordMaintenance('demo', 'eq-1', fd({ performed_at: '2026-05-01', notes: 'oiled', next_due: '2026-08-01', cost: '5000' }));
    expect(r.ok).toBe(true);
    const log = state.inserts.find((i) => i.table === 'equipment_maintenance')!;
    expect(log.payload).toMatchObject({ equipment_id: 'eq-1', gym_id: 'gym-1', performed_at: '2026-05-01', cost: 5000, next_due: '2026-08-01' });
    const upd = state.updates.find((u) => u.table === 'equipment')!;
    expect(upd.payload).toMatchObject({ last_maintenance_date: '2026-05-01', next_maintenance_date: '2026-08-01' });
    expect(upd.eqs).toContainEqual({ col: 'id', val: 'eq-1' });
    expect(upd.eqs).toContainEqual({ col: 'gym_id', val: 'gym-1' });
  });

  it('requires a staff session', async () => {
    requireStaffMock.mockRejectedValueOnce(new Error('redirect'));
    await expect(recordMaintenance('demo', 'eq-1', fd({}))).rejects.toThrow();
    expect(state.inserts).toHaveLength(0);
  });
});
