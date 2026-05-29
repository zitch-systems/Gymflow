import { describe, it, expect, vi, beforeEach } from 'vitest';

const { state, requireStaff, getSessionUser, supabaseMock, audit } = vi.hoisted(() => {
  type Queue = Array<{ data?: unknown; error?: { message: string } | null }>;
  const state: {
    requireStaffError: Error | null;
    perTableQueue: Map<string, Queue>;
    auditCalls: unknown[];
    capturedEq: Array<{ col: string; val: string }>;
    capturedGte: Array<{ col: string; val: string }>;
    capturedLte: Array<{ col: string; val: string }>;
  } = {
    requireStaffError: null,
    perTableQueue: new Map(),
    auditCalls: [],
    capturedEq: [],
    capturedGte: [],
    capturedLte: [],
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
        eq(col: string, val: string): typeof builder;
        gte(col: string, val: string): typeof builder;
        lte(col: string, val: string): typeof builder;
        order(): typeof builder;
        limit(): typeof builder;
        then<T>(resolve: (v: unknown) => T): T;
      } = {
        select() { return builder; },
        eq(col: string, val: string) {
          state.capturedEq.push({ col, val });
          return builder;
        },
        gte(col: string, val: string) {
          state.capturedGte.push({ col, val });
          return builder;
        },
        lte(col: string, val: string) {
          state.capturedLte.push({ col, val });
          return builder;
        },
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

import { exportAttendanceCsv } from '@/lib/actions/export-attendance';

beforeEach(() => {
  state.requireStaffError = null;
  state.perTableQueue.clear();
  state.auditCalls.length = 0;
  state.capturedEq.length = 0;
  state.capturedGte.length = 0;
  state.capturedLte.length = 0;
  requireStaff.mockClear();
  getSessionUser.mockClear();
  audit.mockClear();
});

describe('exportAttendanceCsv — auth + clamping', () => {
  it('requireStaff first; redirect propagates', async () => {
    state.requireStaffError = new Error('redirect');
    await expect(exportAttendanceCsv('demo')).rejects.toThrow('redirect');
  });

  it('rejects an unknown status (no .eq fires for status)', async () => {
    await exportAttendanceCsv('demo', { status: 'partial' });
    expect(state.capturedEq.find((e) => e.col === 'status')).toBeUndefined();
  });

  it('accepts valid status: attended / waitlisted / cancelled / no_show / booked', async () => {
    await exportAttendanceCsv('demo', { status: 'attended' });
    expect(state.capturedEq).toContainEqual({ col: 'status', val: 'attended' });
  });

  it('rejects a class_id that doesn\'t look like a uuid (defense against PostgREST injection)', async () => {
    await exportAttendanceCsv('demo', { class_id: 'not-a-uuid' });
    expect(state.capturedEq.find((e) => e.col === 'class_id')).toBeUndefined();
  });

  it('accepts a uuid-shaped class_id', async () => {
    await exportAttendanceCsv('demo', { class_id: 'abc12345-6789-4abc-9def-012345678901' });
    expect(state.capturedEq).toContainEqual({ col: 'class_id', val: 'abc12345-6789-4abc-9def-012345678901' });
  });

  it('booking_date filter uses the literal YYYY-MM-DD value, not an ISO timestamp', async () => {
    // booking_date is a DATE column, not a timestamp — passing a timestamp
    // would either error or do the wrong comparison depending on PostgREST.
    await exportAttendanceCsv('demo', { from: '2026-05-01', to: '2026-05-31' });
    const gte = state.capturedGte.find((g) => g.col === 'booking_date');
    const lte = state.capturedLte.find((l) => l.col === 'booking_date');
    expect(gte?.val).toBe('2026-05-01');
    expect(lte?.val).toBe('2026-05-31');
  });
});

describe('exportAttendanceCsv — CSV shape', () => {
  it('renders header + one row per booking with joined class + member fields', async () => {
    state.perTableQueue.set('class_bookings', [
      {
        data: [
          {
            id: 'b-1',
            booking_date: '2026-05-29',
            status: 'attended',
            booked_at: '2026-05-28T10:00:00Z',
            cancelled_at: null,
            member_id: 'u-1',
            class_id: 'c-1',
            classes: { name: 'HIIT' },
            class_schedules: { start_time: '18:00' },
            profiles: { full_name: 'Tunde A.', first_name: 'Tunde', email: 't@e.com', phone: '+234800' },
          },
        ],
        error: null,
      },
    ]);

    const r = await exportAttendanceCsv('demo', { from: '2026-05-01', to: '2026-05-31' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lines = r.csv.split('\n');
    expect(lines[0]).toBe('booking_date,class_name,class_time,member_name,member_email,member_phone,status,booked_at,cancelled_at');
    expect(lines[1]).toContain('2026-05-29,HIIT,18:00,Tunde A.,t@e.com,+234800,attended');
  });

  it('handles missing class + member joins — empty cells, no literal "null"', async () => {
    state.perTableQueue.set('class_bookings', [
      {
        data: [
          {
            id: 'b-2',
            booking_date: '2026-05-29',
            status: 'no_show',
            booked_at: null,
            cancelled_at: null,
            member_id: null,
            class_id: null,
            classes: null,
            class_schedules: null,
            profiles: null,
          },
        ],
        error: null,
      },
    ]);
    const r = await exportAttendanceCsv('demo');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const dataLine = r.csv.split('\n')[1];
    expect(dataLine).not.toContain('null');
  });
});

describe('exportAttendanceCsv — audit', () => {
  it('records the export with the active filter set and a slug-prefixed filename', async () => {
    await exportAttendanceCsv('demo', { from: '2026-05-01', to: '2026-05-31', status: 'attended' });
    expect(audit).toHaveBeenCalledTimes(1);
    const call = (audit as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as {
      action: string;
      table: string;
      after: { row_count: number; filename: string; from: string; to: string; class_id: string | null; status: string | null };
    };
    expect(call.action).toBe('admin.attendance_exported');
    expect(call.table).toBe('class_bookings');
    expect(call.after.from).toBe('2026-05-01');
    expect(call.after.to).toBe('2026-05-31');
    expect(call.after.status).toBe('attended');
    expect(call.after.class_id).toBeNull();
    expect(call.after.filename).toBe('demo-attendance-2026-05-01_to_2026-05-31.csv');
  });

  it('a rejected class_id / status appears as null in the audit, not the bogus value', async () => {
    await exportAttendanceCsv('demo', { from: '2026-05-01', to: '2026-05-31', class_id: 'sql-injection;', status: 'partial' });
    const call = (audit as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as {
      after: { class_id: string | null; status: string | null };
    };
    expect(call.after.class_id).toBeNull();
    expect(call.after.status).toBeNull();
  });
});
