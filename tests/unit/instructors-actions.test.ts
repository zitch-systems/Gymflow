import { describe, it, expect, vi, beforeEach } from 'vitest';
import './_stub-server-only';

// lib/actions/instructors.ts — admin invites a coach + flips active state.
// Cross-tenant safety is the headline invariant (source comment lines 53-58):
// when an invited email already belongs to a user (a member at another gym, an
// owner elsewhere, etc.), the profile MUST NOT be upserted — that would
// clobber their role/gym_id and corrupt the other tenant's user. Instructor
// access for THIS gym comes from the staff link only.
//
// Other invariants pinned here:
//   - requireStaff authz on both functions
//   - email + name required (rejected before any auth-admin call)
//   - hard createUser error returned verbatim (only "already registered" is
//     recovered into the existing-user path)
//   - the staff link upsert is gym-scoped with onConflict
//     (gym_id,user_id,role) so re-inviting the same instructor is idempotent
//   - instructor_pricing inserted only when session_rate > 0
//   - temp password notification fires ONLY for genuinely-new accounts (no
//     leak to an existing account); WhatsApp gated on phone presence
//   - setInstructorActive scopes the UPDATE by gym_id + user_id + role
//     (no IDOR, no accidentally toggling someone's owner status)

const { state, requireStaffMock, getSessionMock, sendTempMock, waTempMock } = vi.hoisted(() => {
  type EqCall = { col: string; val: unknown };
  const state: {
    createResult: { data: { user: { id: string } } | null; error: { message: string } | null };
    createCalls: number;
    profileLookup: { data: { id: string } | null; error: null };
    upserts: Array<{ table: string; payload: Record<string, unknown>; onConflict?: string }>;
    inserts: Array<{ table: string; payload: Record<string, unknown> }>;
    staffLinkUpdates: Array<{ payload: Record<string, unknown>; eqs: EqCall[] }>;
    staffLinkUpdateError: { message: string } | null;
  } = {
    createResult: { data: { user: { id: 'new-coach-1' } }, error: null },
    createCalls: 0,
    profileLookup: { data: null, error: null },
    upserts: [],
    inserts: [],
    staffLinkUpdates: [],
    staffLinkUpdateError: null,
  };
  const requireStaffMock = vi.fn(async (slug: string) => { void slug; return { role: 'manager', gym: { id: 'gym-1', slug: 'iron', name: 'Iron Temple' } }; });
  const getSessionMock = vi.fn(async () => ({ id: 'actor-1' }));
  const sendTempMock = vi.fn(async () => ({ ok: true }));
  const waTempMock = vi.fn(async () => ({ ok: true }));
  return { state, requireStaffMock, getSessionMock, sendTempMock, waTempMock };
});

function makeAdmin() {
  return {
    auth: {
      admin: {
        createUser: async (_args: unknown) => { void _args; state.createCalls += 1; return state.createResult; },
      },
    },
    from(table: string) {
      const eqs: { col: string; val: unknown }[] = [];
      const builder = {
        _payload: null as Record<string, unknown> | null,
        select() { return builder; },
        ilike() { return builder; },
        eq(col: string, val: unknown) {
          eqs.push({ col, val });
          if (table === 'gym_staff_links' && builder._payload) {
            // Snapshot on every .eq() so we capture the final state once all
            // three filters are applied; assert with .at(-1) in the test.
            state.staffLinkUpdates.push({ payload: builder._payload, eqs: [...eqs] });
          }
          const err = table === 'gym_staff_links' ? state.staffLinkUpdateError : null;
          // Both awaitable AND chainable — the production code chains .eq().eq().eq()
          // and then awaits the terminal value.
          const result = Promise.resolve({ error: err });
          return Object.assign(result, builder);
        },
        update(p: Record<string, unknown>) { builder._payload = p; return builder; },
        upsert(p: Record<string, unknown>, opts?: { onConflict?: string }) {
          state.upserts.push({ table, payload: p, onConflict: opts?.onConflict });
          return Promise.resolve({ error: null });
        },
        insert(p: Record<string, unknown>) { state.inserts.push({ table, payload: p }); return Promise.resolve({ error: null }); },
        maybeSingle: () => Promise.resolve(state.profileLookup),
      };
      return builder;
    },
  };
}

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => makeAdmin() }));
vi.mock('@/lib/auth/gym', () => ({ requireStaff: requireStaffMock }));
vi.mock('@/lib/auth/dal', () => ({ getSessionUser: getSessionMock }));
vi.mock('@/lib/email', () => ({ sendTempPassword: sendTempMock }));
vi.mock('@/lib/whatsapp', () => ({ waTempPassword: waTempMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { inviteInstructor, setInstructorActive } from '@/lib/actions/instructors';

function fd(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
}

const profileUpsert = () => state.upserts.find((u) => u.table === 'profiles');
const linkUpsert = () => state.upserts.find((u) => u.table === 'gym_staff_links');
const pricingInsert = () => state.inserts.find((i) => i.table === 'instructor_pricing');
const auditRow = () => state.inserts.find((i) => i.table === 'audit_logs');

beforeEach(() => {
  state.createResult = { data: { user: { id: 'new-coach-1' } }, error: null };
  state.createCalls = 0;
  state.profileLookup = { data: null, error: null };
  state.upserts = [];
  state.inserts = [];
  state.staffLinkUpdates = [];
  state.staffLinkUpdateError = null;
  requireStaffMock.mockClear();
  sendTempMock.mockClear();
  waTempMock.mockClear();
});

describe('inviteInstructor — authz + validation', () => {
  it('requires a staff session', async () => {
    requireStaffMock.mockRejectedValueOnce(new Error('redirect'));
    await expect(inviteInstructor('demo', fd({ email: 'c@e.com', full_name: 'Ada' }))).rejects.toThrow();
    expect(state.createCalls).toBe(0);
    expect(state.upserts).toHaveLength(0);
  });

  it('rejects missing email or name before calling auth-admin', async () => {
    expect((await inviteInstructor('demo', fd({ email: '', full_name: 'Ada' }))).ok).toBe(false);
    expect((await inviteInstructor('demo', fd({ email: 'c@e.com', full_name: '' }))).ok).toBe(false);
    expect(state.createCalls).toBe(0);
  });
});

describe('inviteInstructor — new account path', () => {
  it('creates the auth user, upserts profile (role=instructor) + staff link, sends a temp password', async () => {
    const r = await inviteInstructor('demo', fd({ email: 'Coach@Example.COM', full_name: 'Ada Lovelace', phone: '+2348100000000' }));
    expect(r.ok).toBe(true);
    expect(state.createCalls).toBe(1);
    expect(profileUpsert()!.payload).toMatchObject({ id: 'new-coach-1', email: 'coach@example.com', role: 'instructor', gym_id: 'gym-1' });
    expect(linkUpsert()!.payload).toMatchObject({ gym_id: 'gym-1', user_id: 'new-coach-1', role: 'instructor' });
    expect(linkUpsert()!.onConflict).toBe('gym_id,user_id,role');
    expect(sendTempMock).toHaveBeenCalledTimes(1);
    expect(waTempMock).toHaveBeenCalledTimes(1);
    expect(auditRow()!.payload).toMatchObject({ action: 'admin.instructor_invited', record_id: 'new-coach-1' });
  });

  it('skips WhatsApp when no phone is given', async () => {
    await inviteInstructor('demo', fd({ email: 'c@e.com', full_name: 'Ada' }));
    expect(sendTempMock).toHaveBeenCalledTimes(1);
    expect(waTempMock).not.toHaveBeenCalled();
  });

  it('inserts instructor_pricing only when session_rate > 0', async () => {
    await inviteInstructor('demo', fd({ email: 'c@e.com', full_name: 'Ada', specialisation: 'HIIT', session_rate: '15000' }));
    expect(pricingInsert()!.payload).toMatchObject({ gym_id: 'gym-1', instructor_id: 'new-coach-1', price: 15000 });
  });

  it('does NOT insert instructor_pricing when session_rate is missing or zero', async () => {
    await inviteInstructor('demo', fd({ email: 'c@e.com', full_name: 'Ada' }));
    expect(pricingInsert()).toBeUndefined();
  });

  it('returns a hard createUser error verbatim and does NOT link or notify', async () => {
    state.createResult = { data: null, error: { message: 'password too weak' } };
    const r = await inviteInstructor('demo', fd({ email: 'c@e.com', full_name: 'Ada' }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('password too weak');
    expect(state.upserts).toHaveLength(0);
    expect(sendTempMock).not.toHaveBeenCalled();
  });
});

describe('inviteInstructor — existing-account cross-tenant safety', () => {
  it('does NOT upsert profile when the email already belongs to a user (cross-tenant safety)', async () => {
    // The headline invariant. The comment in the source says: "we must NOT
    // clobber their role/gym_id — that would corrupt another tenant's user
    // and misdirect their login." This test locks that down.
    state.createResult = { data: null, error: { message: 'User already registered' } };
    state.profileLookup = { data: { id: 'existing-7' }, error: null };
    const r = await inviteInstructor('demo', fd({ email: 'existing@e.com', full_name: 'Ada' }));
    expect(r.ok).toBe(true);
    expect(profileUpsert()).toBeUndefined();
    // The staff link IS upserted for this gym so the user can sign in as an
    // instructor here — that's how access is granted, not via profiles.role.
    expect(linkUpsert()!.payload).toMatchObject({ gym_id: 'gym-1', user_id: 'existing-7', role: 'instructor' });
    // No temp-password leak to an established account.
    expect(sendTempMock).not.toHaveBeenCalled();
    expect(waTempMock).not.toHaveBeenCalled();
  });

  it('returns an error when an "already registered" user cannot be resolved in profiles', async () => {
    state.createResult = { data: null, error: { message: 'email exists' } };
    state.profileLookup = { data: null, error: null };
    const r = await inviteInstructor('demo', fd({ email: 'c@e.com', full_name: 'Ada' }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Could not provision/);
    expect(state.upserts).toHaveLength(0);
  });
});

describe('setInstructorActive', () => {
  it('requires staff auth', async () => {
    requireStaffMock.mockRejectedValueOnce(new Error('redirect'));
    await expect(setInstructorActive('demo', 'coach-1', false)).rejects.toThrow();
    expect(state.staffLinkUpdates).toHaveLength(0);
  });

  it('scopes the UPDATE to gym_id + user_id + role=instructor (no IDOR, no toggling an owner\'s status)', async () => {
    await setInstructorActive('demo', 'coach-1', false);
    const upd = state.staffLinkUpdates.at(-1)!;
    expect(upd.payload).toEqual({ is_active: false });
    expect(upd.eqs).toContainEqual({ col: 'gym_id', val: 'gym-1' });
    expect(upd.eqs).toContainEqual({ col: 'user_id', val: 'coach-1' });
    // The role filter is the load-bearing bit: without it an admin could
    // accidentally (or maliciously) flip an owner row's is_active too.
    expect(upd.eqs).toContainEqual({ col: 'role', val: 'instructor' });
  });

  it('surfaces a DB error', async () => {
    state.staffLinkUpdateError = { message: 'rls denied' };
    const r = await setInstructorActive('demo', 'coach-1', true);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('rls denied');
  });
});
