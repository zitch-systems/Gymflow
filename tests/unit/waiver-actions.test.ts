import { describe, it, expect, vi, beforeEach } from 'vitest';
import './_stub-server-only';

// lib/actions/waiver.ts — saveWaiver replaces a gym's active liability waiver.
// It's the legal-liability surface, so the invariants worth locking:
//   - requireStaff authz (no waiver write without a staff session)
//   - silent no-op on empty content (current behaviour — pinned so it can't
//     drift into writing a blank waiver)
//   - two-step "deactivate prior versions, THEN insert the new active one";
//     order matters or you briefly have two active waivers (or none)
//   - the deactivate UPDATE is scoped to gym_id — NOT global, or saving a
//     waiver at one gym would deactivate every other gym's waiver too
//   - the inserted row carries the staff-session gym_id and is_active=true
//   - title/version fall back to sensible defaults

const { state, requireStaffMock } = vi.hoisted(() => {
  type EqCall = { col: string; val: unknown };
  const state: {
    updates: Array<{ table: string; payload: Record<string, unknown>; eqs: EqCall[] }>;
    inserts: Array<{ table: string; payload: Record<string, unknown> }>;
    callOrder: string[];
  } = { updates: [], inserts: [], callOrder: [] };
  const requireStaffMock = vi.fn(async (slug: string) => { void slug; return { role: 'manager', gym: { id: 'gym-1' } }; });
  return { state, requireStaffMock };
});

function makeClient() {
  return {
    from(table: string) {
      const eqs: { col: string; val: unknown }[] = [];
      const builder = {
        _payload: null as Record<string, unknown> | null,
        update(p: Record<string, unknown>) { builder._payload = p; return builder; },
        insert(p: Record<string, unknown>) {
          state.inserts.push({ table, payload: p });
          state.callOrder.push(`insert:${table}`);
          return Promise.resolve({ error: null });
        },
        eq(col: string, val: unknown) {
          eqs.push({ col, val });
          state.updates.push({ table, payload: builder._payload!, eqs: [...eqs] });
          state.callOrder.push(`update:${table}`);
          return Promise.resolve({ error: null });
        },
      };
      return builder;
    },
  };
}

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => makeClient() }));
vi.mock('@/lib/auth/gym', () => ({ requireStaff: requireStaffMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { saveWaiver } from '@/lib/actions/waiver';

function fd(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
}

beforeEach(() => {
  state.updates = [];
  state.inserts = [];
  state.callOrder = [];
  requireStaffMock.mockClear();
});

describe('saveWaiver', () => {
  it('requires a staff session before any DB write', async () => {
    requireStaffMock.mockRejectedValueOnce(new Error('redirect'));
    await expect(saveWaiver('demo', fd({ content: 'You waive everything.' }))).rejects.toThrow();
    expect(state.inserts).toHaveLength(0);
    expect(state.updates).toHaveLength(0);
  });

  it('silently no-ops on empty content (does not write a blank waiver)', async () => {
    await saveWaiver('demo', fd({ content: '   ' }));
    expect(state.inserts).toHaveLength(0);
    expect(state.updates).toHaveLength(0);
  });

  it('deactivates prior versions BEFORE inserting the new active one', async () => {
    await saveWaiver('demo', fd({ content: 'Terms', title: 'Waiver', version: '2.0' }));
    // The deactivate update must precede the insert.
    const updIdx = state.callOrder.indexOf('update:waivers');
    const insIdx = state.callOrder.indexOf('insert:waivers');
    expect(updIdx).toBeGreaterThanOrEqual(0);
    expect(insIdx).toBeGreaterThanOrEqual(0);
    expect(updIdx).toBeLessThan(insIdx);
  });

  it('scopes the deactivate to gym_id (NOT global — must not clear other gyms\' waivers)', async () => {
    await saveWaiver('demo', fd({ content: 'Terms' }));
    const deactivate = state.updates.find((u) => u.payload.is_active === false)!;
    expect(deactivate.eqs).toContainEqual({ col: 'gym_id', val: 'gym-1' });
  });

  it('inserts the new waiver with the staff-session gym_id and is_active=true', async () => {
    await saveWaiver('demo', fd({ content: 'You assume all risk.', title: 'Liability Waiver', version: '3.1' }));
    const ins = state.inserts.find((i) => i.table === 'waivers')!;
    expect(ins.payload).toMatchObject({
      gym_id: 'gym-1',
      title: 'Liability Waiver',
      content: 'You assume all risk.',
      version: '3.1',
      is_active: true,
    });
  });

  it('falls back to default title and version when omitted', async () => {
    await saveWaiver('demo', fd({ content: 'Terms' }));
    const ins = state.inserts.find((i) => i.table === 'waivers')!;
    expect(ins.payload.title).toBe('Membership waiver');
    expect(ins.payload.version).toBe('1.0');
  });
});
