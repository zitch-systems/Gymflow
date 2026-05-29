import { describe, it, expect, vi, beforeEach } from 'vitest';
import './_stub-server-only';

// lib/actions/cards.ts — saved-card management. These actions drive what the
// daily auto-debit cron sees:
//   - deleteSavedCard flips is_active + reusable to false so the card stops
//     being charged. The UPDATE is scoped by BOTH id AND member_id; without
//     the member_id filter a member could disable another member's card by
//     guessing the id (IDOR).
//   - setDefaultSavedCard is a two-step "clear all defaults for me, then set
//     this one". Skipping step 1 would let a member end up with multiple
//     is_default=true cards, which the cron then picks ambiguously.

const { state, getSessionMock } = vi.hoisted(() => {
  type EqCall = { col: string; val: unknown };
  const state: {
    sessionUser: { id: string } | null;
    updateError: { message: string } | null;
    updates: Array<{ table: string; payload: Record<string, unknown>; eqs: EqCall[] }>;
  } = { sessionUser: null, updateError: null, updates: [] };
  const getSessionMock = vi.fn(async () => state.sessionUser);
  return { state, getSessionMock };
});

function makeUserClient() {
  return {
    from(table: string) {
      const eqs: { col: string; val: unknown }[] = [];
      type B = {
        _payload: Record<string, unknown> | null;
        update: (p: Record<string, unknown>) => B;
        eq: (col: string, val: unknown) => Promise<{ error: null | { message: string } }> & B;
      };
      const builder = {
        _payload: null as Record<string, unknown> | null,
        update(p: Record<string, unknown>) { builder._payload = p; return builder; },
        eq(col: string, val: unknown) {
          eqs.push({ col, val });
          // Each .eq() call is itself awaitable AND chainable. The action
          // calls a one-eq update (clear-all) and a two-eq update (set this
          // one); push on each terminal await.
          const p = Promise.resolve({ error: state.updateError });
          // Snapshot the call as soon as eq is invoked. For two-eq chains
          // we'll see two pushes; assert with .at(-1) to get the final.
          state.updates.push({ table, payload: builder._payload!, eqs: [...eqs] });
          return Object.assign(p, builder);
        },
      };
      return builder as unknown as B;
    },
  };
}

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => makeUserClient() }));
vi.mock('@/lib/auth/dal', () => ({ getSessionUser: getSessionMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { deleteSavedCard, setDefaultSavedCard } from '@/lib/actions/cards';

beforeEach(() => {
  state.sessionUser = { id: 'member-1' };
  state.updateError = null;
  state.updates = [];
  getSessionMock.mockClear();
});

describe('deleteSavedCard', () => {
  it('returns Not signed in when there is no session — no DB touch', async () => {
    state.sessionUser = null;
    const r = await deleteSavedCard('card-1');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Not signed in/);
    expect(state.updates).toHaveLength(0);
  });

  it('sets is_active=false AND reusable=false (kills auto-debit reuse)', async () => {
    const r = await deleteSavedCard('card-1');
    expect(r.ok).toBe(true);
    const upd = state.updates.at(-1)!;
    expect(upd.table).toBe('saved_cards');
    expect(upd.payload).toEqual({ is_active: false, reusable: false });
  });

  it('scopes the UPDATE to BOTH id AND member_id (no IDOR — can\'t disable another member\'s card)', async () => {
    await deleteSavedCard('victim-card');
    const upd = state.updates.at(-1)!;
    expect(upd.eqs).toContainEqual({ col: 'id', val: 'victim-card' });
    expect(upd.eqs).toContainEqual({ col: 'member_id', val: 'member-1' });
  });

  it('surfaces a DB error', async () => {
    state.updateError = { message: 'update denied' };
    const r = await deleteSavedCard('card-1');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('update denied');
  });
});

describe('setDefaultSavedCard', () => {
  it('returns Not signed in when there is no session — no DB touch', async () => {
    state.sessionUser = null;
    const r = await setDefaultSavedCard('card-1');
    expect(r.ok).toBe(false);
    expect(state.updates).toHaveLength(0);
  });

  it('FIRST clears is_default on ALL the caller\'s cards, THEN sets this one (order matters for the cron)', async () => {
    await setDefaultSavedCard('card-7');
    // Two updates: the clear-all (one .eq on member_id) and the set-this
    // (two .eq: id + member_id). The order is load-bearing.
    const clearAll = state.updates.find((u) => u.payload.is_default === false)!;
    const setOne = state.updates.find((u) => u.payload.is_default === true)!;
    expect(clearAll).toBeDefined();
    expect(setOne).toBeDefined();
    expect(state.updates.indexOf(clearAll)).toBeLessThan(state.updates.indexOf(setOne));
    // Clear-all is scoped to the caller (NOT global): otherwise a member
    // could wipe everyone's defaults.
    expect(clearAll.eqs).toContainEqual({ col: 'member_id', val: 'member-1' });
    expect(clearAll.eqs.find((e) => e.col === 'id')).toBeUndefined();
  });

  it('scopes the set-default UPDATE to BOTH id AND member_id (no IDOR)', async () => {
    await setDefaultSavedCard('victim-card');
    // The set-default chain calls .eq() twice (id then member_id). My builder
    // snapshots on each .eq(), so the FINAL snapshot for the is_default=true
    // payload is the one with both filters applied.
    const setOneFinal = state.updates
      .filter((u) => u.payload.is_default === true)
      .at(-1)!;
    expect(setOneFinal.eqs).toContainEqual({ col: 'id', val: 'victim-card' });
    expect(setOneFinal.eqs).toContainEqual({ col: 'member_id', val: 'member-1' });
  });

  it('surfaces a DB error from the set-default step', async () => {
    state.updateError = { message: 'rls denied' };
    const r = await setDefaultSavedCard('card-1');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('rls denied');
  });
});
