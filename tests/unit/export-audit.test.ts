import { describe, it, expect, vi, beforeEach } from 'vitest';

// exportAuditCsv has three things worth pinning beyond the generic CSV
// invariants already covered by members:
//   - URL-supplied scope/window are CLAMPED to the allowlist, not erroring
//   - the action is itself audited (double-audit so the export leaves a trail)
//   - actor names get joined in via a single batched .in() — no N+1

const { state, requireManager, getSessionUser, supabaseMock, audit } = vi.hoisted(() => {
  type Queue = Array<{ data?: unknown; error?: { message: string } | null }>;
  const state: {
    requireManagerError: Error | null;
    perTableQueue: Map<string, Queue>;
    auditCalls: unknown[];
    capturedIlike: Array<{ col: string; pattern: string }>;
    capturedGte: Array<{ col: string; val: string }>;
  } = {
    requireManagerError: null,
    perTableQueue: new Map(),
    auditCalls: [],
    capturedIlike: [],
    capturedGte: [],
  };
  const requireManager = vi.fn(async (slug: string) => {
    if (state.requireManagerError) throw state.requireManagerError;
    return { gym: { id: 'gym-1', slug, name: 'Demo' }, role: 'gym_owner' };
  });
  const getSessionUser = vi.fn(async () => ({ id: 'mgr-1' }));
  const audit = vi.fn(async (args: unknown) => {
    state.auditCalls.push(args);
  });

  const supabaseMock = {
    from(table: string) {
      const builder: {
        select(): typeof builder;
        eq(): typeof builder;
        gte(col: string, val: string): typeof builder;
        in(): typeof builder;
        ilike(col: string, pattern: string): typeof builder;
        order(): typeof builder;
        limit(): typeof builder;
        then<T>(resolve: (v: unknown) => T): T;
      } = {
        select() { return builder; },
        eq() { return builder; },
        gte(col: string, val: string) {
          state.capturedGte.push({ col, val });
          return builder;
        },
        in() { return builder; },
        ilike(col: string, pattern: string) {
          state.capturedIlike.push({ col, pattern });
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
  return { state, requireManager, getSessionUser, supabaseMock, audit };
});

vi.mock('@/lib/auth/gym', () => ({ requireManager }));
vi.mock('@/lib/auth/dal', () => ({ getSessionUser }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => supabaseMock }));
vi.mock('@/lib/audit', () => ({ audit }));

import { exportAuditCsv } from '@/lib/actions/export-audit';

beforeEach(() => {
  state.requireManagerError = null;
  state.perTableQueue.clear();
  state.auditCalls.length = 0;
  state.capturedIlike.length = 0;
  state.capturedGte.length = 0;
  requireManager.mockClear();
  getSessionUser.mockClear();
  audit.mockClear();
});

describe('exportAuditCsv — auth', () => {
  it('runs requireManager — managers + owners only, no front-desk', async () => {
    await exportAuditCsv('demo', 'all', '30');
    expect(requireManager).toHaveBeenCalledWith('demo');
  });

  it('propagates the requireManager redirect (not-staff or wrong-role gets bounced)', async () => {
    state.requireManagerError = new Error('redirect');
    await expect(exportAuditCsv('demo', 'all', '30')).rejects.toThrow('redirect');
  });
});

describe('exportAuditCsv — filter clamping (no validation errors)', () => {
  it('an unknown scope falls back to "all" — no ilike fires', async () => {
    await exportAuditCsv('demo', 'not-a-scope', '30');
    expect(state.capturedIlike).toHaveLength(0);
  });

  it('a known scope applies action.ilike with the right prefix%', async () => {
    await exportAuditCsv('demo', 'plans', '30');
    expect(state.capturedIlike).toContainEqual({ col: 'action', pattern: 'admin.plan_%' });
  });

  it('the payouts scope filters on the admin.payout_ prefix', async () => {
    await exportAuditCsv('demo', 'payouts', '30');
    expect(state.capturedIlike).toContainEqual({ col: 'action', pattern: 'admin.payout_%' });
  });

  it('the announcements scope filters on the admin.announcement_ prefix', async () => {
    await exportAuditCsv('demo', 'announcements', '30');
    expect(state.capturedIlike).toContainEqual({ col: 'action', pattern: 'admin.announcement_%' });
  });

  it('an unknown window falls back to 30 days', async () => {
    await exportAuditCsv('demo', 'all', '9999');
    const createdAtGte = state.capturedGte.find((g) => g.col === 'created_at');
    expect(createdAtGte).toBeDefined();
    const since = new Date(createdAtGte!.val).getTime();
    const days = (Date.now() - since) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(29.9);
    expect(days).toBeLessThanOrEqual(30.1);
  });

  it('a known 7-day window narrows the gte cutoff', async () => {
    await exportAuditCsv('demo', 'all', '7');
    const createdAtGte = state.capturedGte.find((g) => g.col === 'created_at');
    expect(createdAtGte).toBeDefined();
    const days = (Date.now() - new Date(createdAtGte!.val).getTime()) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(6.9);
    expect(days).toBeLessThanOrEqual(7.1);
  });
});

describe('exportAuditCsv — actor join + CSV shape', () => {
  it('joins actor names from profiles in a single batched lookup (no N+1)', async () => {
    state.perTableQueue.set('audit_logs', [
      {
        data: [
          { id: 'a-1', created_at: '2026-05-29T10:00:00Z', action: 'admin.plan_updated', table_name: 'membership_plans', record_id: 'p-1', actor_id: 'mgr-1', old_values: { price: 20000 }, new_values: { price: 22000 } },
          { id: 'a-2', created_at: '2026-05-29T11:00:00Z', action: 'admin.plan_deleted', table_name: 'membership_plans', record_id: 'p-2', actor_id: 'mgr-1', old_values: { name: 'Old' }, new_values: null },
        ],
        error: null,
      },
    ]);
    state.perTableQueue.set('profiles', [
      { data: [{ id: 'mgr-1', full_name: 'Tunde Adesina', first_name: 'Tunde', email: 'tunde@example.com' }], error: null },
    ]);

    const r = await exportAuditCsv('demo', 'plans', '30');
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const lines = r.csv.split('\n');
    expect(lines[0]).toBe('timestamp,actor_name,actor_email,action,action_label,table_name,record_id,old_values,new_values');
    // Both rows show "Tunde Adesina" — proves a single profiles fetch served both events.
    expect(lines[1]).toContain('Tunde Adesina');
    expect(lines[1]).toContain('tunde@example.com');
    expect(lines[1]).toContain('Updated plan'); // human label from actionLabel()
    expect(lines[2]).toContain('Tunde Adesina');
    expect(r.rows).toBe(2);
  });

  it('JSONB old/new values are stringified and quoted (commas inside)', async () => {
    state.perTableQueue.set('audit_logs', [
      {
        data: [
          { id: 'a-1', created_at: '2026-05-29T10:00:00Z', action: 'admin.plan_updated', table_name: 'membership_plans', record_id: 'p-1', actor_id: null, old_values: { price: 20000, name: 'Monthly' }, new_values: { price: 22000, name: 'Monthly' } },
        ],
        error: null,
      },
    ]);

    const r = await exportAuditCsv('demo', 'plans', '30');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The JSON object has commas, so the cell must be wrapped + internal quotes doubled.
    expect(r.csv).toContain('"{""price"":20000,""name"":""Monthly""}"');
  });

  it('null old_values / new_values render as empty cells, not literal "null"', async () => {
    state.perTableQueue.set('audit_logs', [
      {
        data: [
          { id: 'a-1', created_at: '2026-05-29T10:00:00Z', action: 'admin.plan_created', table_name: 'membership_plans', record_id: 'p-1', actor_id: null, old_values: null, new_values: null },
        ],
        error: null,
      },
    ]);
    const r = await exportAuditCsv('demo', 'plans', '30');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const dataLine = r.csv.split('\n')[1];
    expect(dataLine.endsWith(',,')).toBe(true); // trailing two empty cells, not ",null,null"
  });
});

describe('exportAuditCsv — double-audit (compliance)', () => {
  it('the export itself is recorded in audit_logs', async () => {
    state.perTableQueue.set('audit_logs', [{ data: [], error: null }]);
    await exportAuditCsv('demo', 'plans', '30');
    expect(audit).toHaveBeenCalledTimes(1);
    const call = (audit as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as {
      action: string;
      table: string;
      after: { row_count: number; filename: string; scope: string; days: number };
    };
    expect(call.action).toBe('admin.audit_exported');
    expect(call.table).toBe('audit_logs');
    expect(call.after.scope).toBe('plans');
    expect(call.after.days).toBe(30);
    expect(call.after.filename).toMatch(/^demo-audit-plans-30d-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('filename uses "all" instead of the scope id when scope is "all"', async () => {
    state.perTableQueue.set('audit_logs', [{ data: [], error: null }]);
    const r = await exportAuditCsv('demo', 'all', '7');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filename).toMatch(/^demo-audit-all-7d-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
