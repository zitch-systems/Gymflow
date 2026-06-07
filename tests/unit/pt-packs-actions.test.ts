import { describe, it, expect, vi, beforeEach } from 'vitest';
import './_stub-server-only';

// consumePtCredit — the credit-decrement on coach session scheduling. (The
// admin PT-packs surface — createPtPack / setPtPackActive / grantPtPackToMember
// — was cut with the other non-prototype admin routes; only this coach-side
// helper remains.) The load-bearing invariants:
//   - consumePtCredit picks the oldest credit with balance (FIFO), only
//     decrements when sessions_used is still where we read it (concurrent-
//     booking guard), and returns consumed:false (not an error) when the
//     member has no balance — the session still books

const { state, requireStaffMock, getSessionMock, auditMock } = vi.hoisted(() => {
  type Pack = { id: string; gym_id: string; instructor_id: string; name: string; session_count: number; is_active: boolean };
  type Credit = { id: string; gym_id: string; member_id: string; instructor_id: string; sessions_total: number; sessions_used: number; purchased_at: string };
  type EqCall = { col: string; val: unknown };
  const state: {
    packs: Pack[];
    credits: Credit[];
    inserts: Array<{ table: string; payload: Record<string, unknown> }>;
    updates: Array<{ table: string; payload: Record<string, unknown>; eqs: EqCall[] }>;
    // For the concurrent-update test: bump sessions_used between the SELECT
    // and the UPDATE, so the .eq('sessions_used', snapshot) filter misses.
    raceBumpUsed: boolean;
    memberLinks: Array<{ gym_id: string; user_id: string }>;
    coachLinks: Array<{ gym_id: string; user_id: string; role: string; is_active: boolean }>;
    writeError: { message: string } | null;
  } = {
    packs: [],
    credits: [],
    inserts: [],
    updates: [],
    raceBumpUsed: false,
    memberLinks: [],
    coachLinks: [],
    writeError: null,
  };
  const requireStaffMock = vi.fn(async (slug: string) => { void slug; return { role: 'manager', gym: { id: 'gym-1' } }; });
  const getSessionMock = vi.fn(async () => ({ id: 'actor-1' }));
  const auditMock = vi.fn(async () => {});
  return { state, requireStaffMock, getSessionMock, auditMock };
});

function makeAdmin() {
  return {
    from(table: string) {
      const eqs: { col: string; val: unknown }[] = [];
      let order: { col: string; ascending: boolean } | null = null;
      let updatePayload: Record<string, unknown> | null = null;
      let mode: 'select' | 'insert' | 'update' = 'select';
      const builder = {
        // Supabase keeps the operation type when you chain .update().select() —
        // the select just changes what gets returned. Only flip to 'select' when
        // we're starting fresh from a from().select().
        select() { if (mode === 'select') mode = 'select'; return builder; },
        update(p: Record<string, unknown>) { mode = 'update'; updatePayload = p; return builder; },
        insert(p: Record<string, unknown>) {
          mode = 'insert';
          state.inserts.push({ table, payload: p });
          // pt_packs.insert in createPtPack chains .select('id').maybeSingle()
          // so we don't resolve here — let the chain continue.
          return builder;
        },
        eq(col: string, val: unknown) { eqs.push({ col, val }); return builder; },
        order(col: string, opts: { ascending: boolean }) { order = { col, ascending: opts.ascending }; return builder; },
        maybeSingle(): Promise<{ data: unknown; error: null }> {
          if (mode === 'insert' && table === 'pt_packs') {
            const inserted = state.inserts[state.inserts.length - 1].payload as Record<string, unknown>;
            const id = 'pack-new';
            state.packs.push({
              id,
              gym_id: inserted.gym_id as string,
              instructor_id: inserted.instructor_id as string,
              name: inserted.name as string,
              session_count: inserted.session_count as number,
              is_active: true,
            });
            return Promise.resolve({ data: { id }, error: null });
          }
          if (mode === 'update' && table === 'pt_pack_credits') {
            // Optimistic update return — apply if the snapshot filter still
            // matches the row.
            const id = eqs.find((e) => e.col === 'id')?.val as string | undefined;
            const expected = eqs.find((e) => e.col === 'sessions_used')?.val as number | undefined;
            const row = state.credits.find((c) => c.id === id);
            if (!row || row.sessions_used !== expected) return Promise.resolve({ data: null, error: null });
            row.sessions_used = (updatePayload?.sessions_used as number) ?? row.sessions_used;
            return Promise.resolve({ data: { id: row.id, sessions_total: row.sessions_total, sessions_used: row.sessions_used }, error: null });
          }
          if (table === 'pt_packs' && mode === 'select') {
            const gymId = eqs.find((e) => e.col === 'gym_id')?.val as string | undefined;
            const id = eqs.find((e) => e.col === 'id')?.val as string | undefined;
            const isActive = eqs.find((e) => e.col === 'is_active')?.val;
            const found = state.packs.find((p) =>
              (gymId == null || p.gym_id === gymId) &&
              (id == null || p.id === id) &&
              (isActive == null || p.is_active === isActive),
            );
            return Promise.resolve({ data: found ?? null, error: null });
          }
          if (table === 'gym_member_links') {
            const gymId = eqs.find((e) => e.col === 'gym_id')?.val as string | undefined;
            const userId = eqs.find((e) => e.col === 'user_id')?.val as string | undefined;
            const found = state.memberLinks.find((l) => l.gym_id === gymId && l.user_id === userId);
            return Promise.resolve({ data: found ?? null, error: null });
          }
          if (table === 'gym_staff_links') {
            const gymId = eqs.find((e) => e.col === 'gym_id')?.val as string | undefined;
            const userId = eqs.find((e) => e.col === 'user_id')?.val as string | undefined;
            const role = eqs.find((e) => e.col === 'role')?.val as string | undefined;
            const isActive = eqs.find((e) => e.col === 'is_active')?.val;
            const found = state.coachLinks.find((l) =>
              (gymId == null || l.gym_id === gymId) &&
              (userId == null || l.user_id === userId) &&
              (role == null || l.role === role) &&
              (isActive == null || l.is_active === isActive),
            );
            return Promise.resolve({ data: found ?? null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        // Awaited terminals for the select-list (consumePtCredit) and bare
        // update/insert.
        then<T>(resolve: (v: { data?: unknown; error: { message: string } | null }) => T): T {
          if (mode === 'select' && table === 'pt_pack_credits') {
            const gymId = eqs.find((e) => e.col === 'gym_id')?.val as string | undefined;
            const memberId = eqs.find((e) => e.col === 'member_id')?.val as string | undefined;
            const instructorId = eqs.find((e) => e.col === 'instructor_id')?.val as string | undefined;
            let rows = state.credits.filter((c) =>
              (gymId == null || c.gym_id === gymId) &&
              (memberId == null || c.member_id === memberId) &&
              (instructorId == null || c.instructor_id === instructorId),
            );
            if (order?.col === 'purchased_at') {
              rows = [...rows].sort((a, b) => (order!.ascending ? a.purchased_at.localeCompare(b.purchased_at) : b.purchased_at.localeCompare(a.purchased_at)));
            }
            // Snapshot what the caller sees BEFORE the race bump, so the
            // caller's expected value is the pre-race version and the
            // subsequent optimistic UPDATE filter misses.
            const snapshot = rows.map((r) => ({ ...r }));
            if (state.raceBumpUsed) {
              for (const r of state.credits) {
                if (
                  (gymId == null || r.gym_id === gymId) &&
                  (memberId == null || r.member_id === memberId) &&
                  (instructorId == null || r.instructor_id === instructorId) &&
                  r.sessions_used < r.sessions_total
                ) {
                  r.sessions_used += 1;
                }
              }
              state.raceBumpUsed = false; // one-shot
            }
            return resolve({ data: snapshot, error: null });
          }
          if (mode === 'update' && (table === 'pt_packs' || table === 'gym_member_links' || table === 'pt_pack_credits')) {
            state.updates.push({ table, payload: updatePayload!, eqs: [...eqs] });
            return resolve({ error: state.writeError });
          }
          if (mode === 'insert' && table === 'pt_pack_credits') {
            return resolve({ error: state.writeError });
          }
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

import { consumePtCredit } from '@/lib/actions/pt-packs';

function fd(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
}

beforeEach(() => {
  state.packs = [];
  state.credits = [];
  state.inserts = [];
  state.updates = [];
  state.raceBumpUsed = false;
  state.memberLinks = [];
  // Default: coach-1 IS an active instructor at gym-1 (matches createPtPack
  // happy-path expectations). Tests for the new validation gate clear this.
  state.coachLinks = [{ gym_id: 'gym-1', user_id: 'coach-1', role: 'instructor', is_active: true }];
  state.writeError = null;
  requireStaffMock.mockClear();
  auditMock.mockClear();
});

describe('consumePtCredit', () => {
  it('returns consumed:false when the member has no balance — no decrement', async () => {
    state.credits = []; // no credits
    const r = await consumePtCredit({ gymId: 'gym-1', memberId: 'm1', instructorId: 'i1' });
    expect(r.consumed).toBe(false);
  });

  it('returns consumed:false when all credits are spent (no negative balance possible)', async () => {
    state.credits = [{ id: 'c1', gym_id: 'gym-1', member_id: 'm1', instructor_id: 'i1', sessions_total: 5, sessions_used: 5, purchased_at: '2026-01-01' }];
    const r = await consumePtCredit({ gymId: 'gym-1', memberId: 'm1', instructorId: 'i1' });
    expect(r.consumed).toBe(false);
    // sessions_used MUST stay at 5 — never above sessions_total.
    expect(state.credits[0].sessions_used).toBe(5);
  });

  it('decrements the OLDEST credit with balance (FIFO)', async () => {
    state.credits = [
      { id: 'c-new', gym_id: 'gym-1', member_id: 'm1', instructor_id: 'i1', sessions_total: 5, sessions_used: 0, purchased_at: '2026-03-01' },
      { id: 'c-old', gym_id: 'gym-1', member_id: 'm1', instructor_id: 'i1', sessions_total: 5, sessions_used: 1, purchased_at: '2026-01-01' },
    ];
    const r = await consumePtCredit({ gymId: 'gym-1', memberId: 'm1', instructorId: 'i1' });
    expect(r.consumed).toBe(true);
    expect(r.creditId).toBe('c-old');
    expect(state.credits.find((c) => c.id === 'c-old')!.sessions_used).toBe(2);
    expect(state.credits.find((c) => c.id === 'c-new')!.sessions_used).toBe(0);
    expect(r.remaining).toBe(3);
  });

  it('skips on concurrent-booking race (snapshot filter misses) — no silent double-decrement', async () => {
    state.credits = [{ id: 'c1', gym_id: 'gym-1', member_id: 'm1', instructor_id: 'i1', sessions_total: 5, sessions_used: 0, purchased_at: '2026-01-01' }];
    state.raceBumpUsed = true; // race: another scheduler bumped it between SELECT and UPDATE
    const r = await consumePtCredit({ gymId: 'gym-1', memberId: 'm1', instructorId: 'i1' });
    // The other scheduler "won" (state shows sessions_used now 1); we report
    // not-consumed rather than risk decrementing again.
    expect(r.consumed).toBe(false);
    expect(state.credits[0].sessions_used).toBe(1);
  });

  it('scopes by gym_id + member_id + instructor_id — never picks another tenant\'s credit', async () => {
    state.credits = [
      { id: 'c-other-gym', gym_id: 'gym-2', member_id: 'm1', instructor_id: 'i1', sessions_total: 5, sessions_used: 0, purchased_at: '2026-01-01' },
      { id: 'c-other-coach', gym_id: 'gym-1', member_id: 'm1', instructor_id: 'i-other', sessions_total: 5, sessions_used: 0, purchased_at: '2026-01-01' },
    ];
    const r = await consumePtCredit({ gymId: 'gym-1', memberId: 'm1', instructorId: 'i1' });
    expect(r.consumed).toBe(false);
    expect(state.credits.find((c) => c.id === 'c-other-gym')!.sessions_used).toBe(0);
    expect(state.credits.find((c) => c.id === 'c-other-coach')!.sessions_used).toBe(0);
  });
});
