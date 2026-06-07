import { describe, it, expect, vi, beforeEach } from 'vitest';

// Search-members tests focus on the bits that would actually regress: the
// requireStaff gate, the cross-gym RLS scoping, the .or filter sanitisation,
// and the short-query guard. The Supabase pipeline returns a fixed payload —
// we're not testing PostgREST.

const { state, requireStaff, supabaseMock } = vi.hoisted(() => {
  const state: {
    requireStaffError: Error | null;
    capturedSelect: string | null;
    capturedFilters: { col: string; bound: string; val: string }[];
    capturedOrArgs: { filter: string; options: unknown }[];
    rows: unknown;
  } = {
    requireStaffError: null,
    capturedSelect: null,
    capturedFilters: [],
    capturedOrArgs: [],
    rows: null,
  };
  const requireStaff = vi.fn(async (slug: string) => {
    if (state.requireStaffError) throw state.requireStaffError;
    return { gym: { id: 'gym-1', slug, name: 'Demo' }, role: 'manager' };
  });
  const supabaseMock = {
    from() {
      const builder: {
        select(s: string): typeof builder;
        eq(col: string, val: string): typeof builder;
        or(filter: string, options?: unknown): typeof builder;
        limit(n: number): typeof builder;
        then<T>(resolve: (v: unknown) => T): T;
      } = {
        select(s: string) {
          state.capturedSelect = s;
          return builder;
        },
        eq(col: string, val: string) {
          state.capturedFilters.push({ col, bound: 'eq', val });
          return builder;
        },
        or(filter: string, options?: unknown) {
          state.capturedOrArgs.push({ filter, options });
          return builder;
        },
        limit() {
          return builder;
        },
        then<T>(resolve: (v: unknown) => T): T {
          return resolve({ data: state.rows, error: null });
        },
      };
      return builder;
    },
  };
  return { state, requireStaff, supabaseMock };
});

vi.mock('@/lib/auth/gym', () => ({ requireStaff }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => supabaseMock }));

import { searchMembers } from '@/lib/actions/search-members';

beforeEach(() => {
  state.requireStaffError = null;
  state.capturedSelect = null;
  state.capturedFilters = [];
  state.capturedOrArgs = [];
  state.rows = null;
  requireStaff.mockClear();
});

describe('searchMembers — auth + short-query guards', () => {
  it('runs requireStaff(slug) first — front-desk/accountant/manager/owner all allowed', async () => {
    state.rows = [];
    await searchMembers('demo', 'aa');
    expect(requireStaff).toHaveBeenCalledWith('demo');
  });

  it('propagates the requireStaff redirect when caller isn\'t staff', async () => {
    state.requireStaffError = new Error('redirect');
    await expect(searchMembers('demo', 'tunde')).rejects.toThrow('redirect');
  });

  it('returns [] for empty or whitespace queries without hitting the DB', async () => {
    expect(await searchMembers('demo', '')).toEqual([]);
    expect(await searchMembers('demo', '   ')).toEqual([]);
    // No filters captured — the function returned before reaching .from().
    expect(state.capturedFilters).toEqual([]);
    expect(state.capturedOrArgs).toEqual([]);
  });

  it('returns [] for 1-char queries (too noisy to bother)', async () => {
    expect(await searchMembers('demo', 'a')).toEqual([]);
    expect(state.capturedOrArgs).toEqual([]);
  });
});

describe('searchMembers — query sanitisation', () => {
  it('strips PostgREST .or() meaning chars from the user query so they can\'t inject', async () => {
    state.rows = [];
    await searchMembers('demo', 'tu%nd*e,(a)');
    expect(state.capturedOrArgs).toHaveLength(1);
    const orFilter = state.capturedOrArgs[0].filter;
    // Only the sanitised core "tundea" should be the user-derived payload —
    // commas/% in the filter are LEGITIMATE PostgREST .or() syntax separating
    // the three ilike clauses + wrapping the like value. The raw query (with
    // injection chars) must NOT appear verbatim.
    expect(orFilter).not.toContain('tu%nd*e,(a)');
    expect(orFilter).not.toContain('(a)');
    expect(orFilter).not.toContain('*');
    // The sanitised core survives.
    expect(orFilter).toMatch(/tundea/);
  });

  it('returns [] when sanitisation strips the entire query', async () => {
    state.rows = [];
    expect(await searchMembers('demo', '%,(*)')).toEqual([]);
    // No filter reached the DB.
    expect(state.capturedOrArgs).toEqual([]);
  });
});

describe('searchMembers — cross-gym scoping', () => {
  it('filters on the current gym\'s id (no cross-tenant leakage)', async () => {
    state.rows = [];
    await searchMembers('demo', 'tunde');
    const gymFilter = state.capturedFilters.find((f) => f.col === 'gym_id');
    expect(gymFilter).toBeDefined();
    expect(gymFilter?.val).toBe('gym-1');
  });

  it('uses an !inner join via gym_member_links so other-gym profile matches are excluded by RLS', async () => {
    state.rows = [];
    await searchMembers('demo', 'tunde');
    // The select string must !inner-join profiles via gym_member_links so the
    // ilike against profiles is constrained to members of THIS gym only.
    expect(state.capturedSelect).toMatch(/profiles!inner/);
  });
});

describe('searchMembers — result shape', () => {
  it('maps each profile row to { id, label, email, href } and routes to /admin/members/<id>', async () => {
    state.rows = [
      { user_id: 'u-1', profiles: { id: 'u-1', full_name: 'Tunde Adesina', first_name: 'Tunde', email: 'tunde@example.com' } },
      { user_id: 'u-2', profiles: { id: 'u-2', full_name: null, first_name: 'Ngozi', email: 'ngozi@example.com' } },
    ];
    const hits = await searchMembers('demo', 'tunde');
    expect(hits).toEqual([
      { id: 'u-1', label: 'Tunde Adesina', email: 'tunde@example.com', href: '/admin/members/u-1' },
      { id: 'u-2', label: 'Ngozi',         email: 'ngozi@example.com', href: '/admin/members/u-2' },
    ]);
  });

  it('falls back through full_name → first_name → email when fields are null', async () => {
    state.rows = [
      { user_id: 'u-3', profiles: { id: 'u-3', full_name: null, first_name: null, email: 'only@example.com' } },
    ];
    const hits = await searchMembers('demo', 'only');
    expect(hits[0].label).toBe('only@example.com');
  });
});
