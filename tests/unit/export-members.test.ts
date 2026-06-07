import { describe, it, expect, vi, beforeEach } from 'vitest';

const { state, requireStaff, getSessionUser, supabaseMock, audit } = vi.hoisted(() => {
  type Queue = Array<{ data?: unknown; error?: { message: string } | null }>;
  const state: {
    requireStaffError: Error | null;
    perTableQueue: Map<string, Queue>;
    auditCalls: unknown[];
  } = {
    requireStaffError: null,
    perTableQueue: new Map(),
    auditCalls: [],
  };
  const requireStaff = vi.fn(async (slug: string) => {
    if (state.requireStaffError) throw state.requireStaffError;
    return { gym: { id: 'gym-1', slug, name: 'Demo' }, role: 'manager' };
  });
  const getSessionUser = vi.fn(async () => ({ id: 'staff-1' }));
  const audit = vi.fn(async (args: unknown) => {
    state.auditCalls.push(args);
  });
  const supabaseMock = {
    from(table: string) {
      const builder: {
        select(): typeof builder;
        eq(): typeof builder;
        in(): typeof builder;
        order(): typeof builder;
        limit(): typeof builder;
        then<T>(resolve: (v: unknown) => T): T;
      } = {
        select() { return builder; },
        eq() { return builder; },
        in() { return builder; },
        order() { return builder; },
        limit() { return builder; },
        then<T>(resolve: (v: unknown) => T): T {
          const q = state.perTableQueue.get(table);
          return resolve(q?.shift() ?? { data: [], error: null });
        },
      };
      return builder;
    },
  };
  return { state, requireStaff, getSessionUser, supabaseMock, audit };
});

vi.mock('@/lib/auth/gym', () => ({ requireStaff }));
vi.mock('@/lib/auth/dal', () => ({ getSessionUser }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => supabaseMock }));
vi.mock('@/lib/audit', () => ({ audit }));

import { exportMembersCsv } from '@/lib/actions/export-members';

beforeEach(() => {
  state.requireStaffError = null;
  state.perTableQueue.clear();
  state.auditCalls.length = 0;
  requireStaff.mockClear();
  getSessionUser.mockClear();
  audit.mockClear();
});

describe('exportMembersCsv — auth + audit', () => {
  it('runs requireStaff first; redirect propagates', async () => {
    state.requireStaffError = new Error('redirect');
    await expect(exportMembersCsv('demo')).rejects.toThrow('redirect');
  });

  it('writes an audit entry with row_count + filename after a successful export', async () => {
    state.perTableQueue.set('gym_member_links', [
      { data: [{ user_id: 'u-1', joined_at: '2026-05-01', status: 'active' }], error: null },
    ]);
    state.perTableQueue.set('profiles', [
      { data: [{ id: 'u-1', full_name: 'Tunde', first_name: 'Tunde', last_name: null, email: 't@e.com', phone: '+234800' }], error: null },
    ]);
    state.perTableQueue.set('memberships', [
      { data: [{ member_id: 'u-1', status: 'active', end_date: '2030-12-31' }], error: null },
    ]);

    await exportMembersCsv('demo');

    expect(audit).toHaveBeenCalledTimes(1);
    const call = (audit as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as {
      action: string;
      table: string;
      after: { row_count: number; filename: string };
    };
    expect(call.action).toBe('admin.members_exported');
    expect(call.table).toBe('gym_member_links');
    expect(call.after.row_count).toBe(1);
    expect(call.after.filename).toMatch(/^demo-members-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});

describe('exportMembersCsv — empty gym', () => {
  it('returns just the header line + 0 rows', async () => {
    state.perTableQueue.set('gym_member_links', [{ data: [], error: null }]);
    const r = await exportMembersCsv('demo');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toBe(0);
    const lines = r.csv.split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('member_id,full_name,email,phone,joined_at,status,membership_status,membership_end_date,days_left');
  });
});

describe('exportMembersCsv — CSV escaping (RFC 4180)', () => {
  it('escapes commas, quotes, and newlines in names so the CSV is parseable', async () => {
    state.perTableQueue.set('gym_member_links', [
      { data: [{ user_id: 'u-1', joined_at: '2026-05-01', status: 'active' }], error: null },
    ]);
    state.perTableQueue.set('profiles', [
      { data: [{
        id: 'u-1',
        // All three RFC 4180 escape triggers in one cell — comma, quote, newline.
        full_name: 'O\'Brien, "Tunde"\nFitness',
        first_name: 'Tunde',
        last_name: null,
        email: 't@e.com',
        phone: '+234800',
      }], error: null },
    ]);
    state.perTableQueue.set('memberships', [{ data: [], error: null }]);

    const r = await exportMembersCsv('demo');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The name cell must be wrapped in quotes, with internal quotes doubled.
    expect(r.csv).toContain('"O\'Brien, ""Tunde""\nFitness"');
  });

  it('renders null / undefined cells as empty (not "null")', async () => {
    state.perTableQueue.set('gym_member_links', [
      { data: [{ user_id: 'u-1', joined_at: null, status: null }], error: null },
    ]);
    state.perTableQueue.set('profiles', [
      { data: [{ id: 'u-1', full_name: null, first_name: null, last_name: null, email: null, phone: null }], error: null },
    ]);
    state.perTableQueue.set('memberships', [{ data: [], error: null }]);

    const r = await exportMembersCsv('demo');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const dataLine = r.csv.split('\n')[1];
    // All cells empty except member_id (which is u-1).
    expect(dataLine).toBe('u-1,,,,,,,,');
  });
});

describe('exportMembersCsv — membership join', () => {
  it('only the LATEST membership per member is exported (drops older end_dates)', async () => {
    state.perTableQueue.set('gym_member_links', [
      { data: [{ user_id: 'u-1', joined_at: '2026-05-01', status: 'active' }], error: null },
    ]);
    state.perTableQueue.set('profiles', [
      { data: [{ id: 'u-1', full_name: 'Tunde', first_name: 'Tunde', last_name: null, email: 't@e.com', phone: '+234800' }], error: null },
    ]);
    // memberships ordered desc by end_date — first row wins, older entries dropped.
    state.perTableQueue.set('memberships', [
      { data: [
        { member_id: 'u-1', status: 'active',  end_date: '2030-12-31' },
        { member_id: 'u-1', status: 'expired', end_date: '2025-12-31' },
      ], error: null },
    ]);

    const r = await exportMembersCsv('demo');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.csv).toContain('2030-12-31');
    expect(r.csv).not.toContain('2025-12-31');
  });
});
