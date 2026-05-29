import { describe, it, expect, vi, beforeEach } from 'vitest';
import './_stub-server-only';

// adminOnboardMember (lib/actions/members.ts) is the admin "add a member"
// path. It calls Supabase auth-admin createUser, then upserts gym_member_links
// and optionally provisions a membership + payment, audits, sends a temp
// password, and finally redirect()s to the member page — all via the
// service-role client. Untested until now.
//
// Behavioural notes pinned by these tests (matching the REAL code):
//   - success ends in redirect(), which throws NEXT_REDIRECT in Next — so a
//     successful call REJECTS; validation failures RETURN { error } normally.
//   - existing users are detected by a createUser "already registered" error
//     then resolved via profiles.ilike(email) (listUsers is paginated and
//     unreliable past 50 users — the code deliberately avoids it).
//   - the temp-password notification only fires for genuinely-new accounts.

const { state, requireStaffMock, getSessionMock, sendTempMock, waTempMock } = vi.hoisted(() => {
  type EqCall = { col: string; val: unknown };
  const state: {
    createUserResult: { data: { user: { id: string } } | null; error: { message: string } | null };
    createUserArgs: { email?: string } | null;
    createUserCalls: number;
    profileLookup: { data: { id: string } | null; error: null };
    planLookup: { data: { duration_months: number } | null; error: null };
    membershipInsertResult: { data: { id: string } | null; error: null };
    upsertErrors: Map<string, { message: string } | null>;
    upserts: Array<{ table: string; payload: Record<string, unknown>; onConflict?: string }>;
    inserts: Array<{ table: string; payload: Record<string, unknown> }>;
    planSelectEqs: EqCall[];
  } = {
    createUserResult: { data: { user: { id: 'new-user-1' } }, error: null },
    createUserArgs: null,
    createUserCalls: 0,
    profileLookup: { data: null, error: null },
    planLookup: { data: null, error: null },
    membershipInsertResult: { data: { id: 'mem-new' }, error: null },
    upsertErrors: new Map(),
    upserts: [],
    inserts: [],
    planSelectEqs: [],
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
        createUser: async (args: { email?: string }) => {
          state.createUserCalls += 1;
          state.createUserArgs = args;
          return state.createUserResult;
        },
      },
    },
    from(table: string) {
      const eqs: { col: string; val: unknown }[] = [];
      const builder = {
        _payload: null as Record<string, unknown> | null,
        select() { return builder; },
        ilike() { return builder; },
        eq(col: string, val: unknown) { eqs.push({ col, val }); return builder; },
        insert(p: Record<string, unknown>) { builder._payload = p; state.inserts.push({ table, payload: p }); return builder; },
        upsert(p: Record<string, unknown>, opts?: { onConflict?: string }) {
          state.upserts.push({ table, payload: p, onConflict: opts?.onConflict });
          return Promise.resolve({ error: state.upsertErrors.get(table) ?? null });
        },
        maybeSingle() {
          if (table === 'profiles') return Promise.resolve(state.profileLookup);
          if (table === 'membership_plans') { state.planSelectEqs = [...eqs]; return Promise.resolve(state.planLookup); }
          if (table === 'memberships') return Promise.resolve(state.membershipInsertResult);
          return Promise.resolve({ data: null, error: null });
        },
        // Awaited directly (payments + audit_logs inserts have no maybeSingle).
        then<T>(resolve: (v: { error: null }) => T): T { return resolve({ error: null }); },
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
// redirect throws in Next; model that so the success path is observable.
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); } }));

import { adminOnboardMember } from '@/lib/actions/members';

function fd(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
}

const auditRows = () => state.inserts.filter((i) => i.table === 'audit_logs');
const linkUpsert = () => state.upserts.find((u) => u.table === 'gym_member_links');

beforeEach(() => {
  state.createUserResult = { data: { user: { id: 'new-user-1' } }, error: null };
  state.createUserArgs = null;
  state.createUserCalls = 0;
  state.profileLookup = { data: null, error: null };
  state.planLookup = { data: null, error: null };
  state.membershipInsertResult = { data: { id: 'mem-new' }, error: null };
  state.upsertErrors = new Map();
  state.upserts = [];
  state.inserts = [];
  state.planSelectEqs = [];
  requireStaffMock.mockClear();
  sendTempMock.mockClear();
  waTempMock.mockClear();
});

describe('adminOnboardMember — authz + validation', () => {
  it('requires a staff session before doing anything', async () => {
    requireStaffMock.mockRejectedValueOnce(new Error('redirect-login'));
    await expect(adminOnboardMember('demo', fd({ full_name: 'Ada', email: 'a@e.com' }))).rejects.toThrow('redirect-login');
    expect(state.createUserCalls).toBe(0);
    expect(state.upserts).toHaveLength(0);
  });

  it('returns an error on missing name (no throw, no createUser)', async () => {
    const r = await adminOnboardMember('demo', fd({ full_name: '', email: 'a@e.com' }));
    expect(r).toEqual({ error: 'Name and email are required.' });
    expect(state.createUserCalls).toBe(0);
  });

  it('returns an error on missing email', async () => {
    const r = await adminOnboardMember('demo', fd({ full_name: 'Ada', email: '' }));
    expect(r).toEqual({ error: 'Name and email are required.' });
  });
});

describe('adminOnboardMember — new user', () => {
  it('creates the auth user, links the gym, sends a temp password, then redirects', async () => {
    await expect(adminOnboardMember('demo', fd({ full_name: 'Ada Lovelace', email: 'a@e.com', phone: '+2348100000000' })))
      .rejects.toThrow(/NEXT_REDIRECT:.*\/admin\/members\/new-user-1/);
    expect(state.createUserCalls).toBe(1);
    // gym link is upserted under the new id, scoped to the staff-session gym.
    const link = linkUpsert()!;
    expect(link.payload).toMatchObject({ gym_id: 'gym-1', user_id: 'new-user-1', member_id: 'new-user-1' });
    expect(link.onConflict).toBe('gym_id,user_id');
    // temp-password notification fires for a genuinely-new account (both channels — phone present).
    expect(sendTempMock).toHaveBeenCalledTimes(1);
    expect(waTempMock).toHaveBeenCalledTimes(1);
  });

  it('lower-cases the email passed to createUser', async () => {
    await expect(adminOnboardMember('demo', fd({ full_name: 'Ada', email: 'Ada@Example.COM' }))).rejects.toThrow('NEXT_REDIRECT');
    expect(state.createUserArgs?.email).toBe('ada@example.com');
  });

  it('does not send a WhatsApp temp password when no phone is given', async () => {
    await expect(adminOnboardMember('demo', fd({ full_name: 'Ada', email: 'a@e.com' }))).rejects.toThrow('NEXT_REDIRECT');
    expect(sendTempMock).toHaveBeenCalledTimes(1);
    expect(waTempMock).not.toHaveBeenCalled();
  });

  it('returns a hard createUser error verbatim and does NOT link or redirect', async () => {
    state.createUserResult = { data: null, error: { message: 'password too weak' } };
    const r = await adminOnboardMember('demo', fd({ full_name: 'Ada', email: 'a@e.com' }));
    expect(r).toEqual({ error: 'password too weak' });
    expect(state.upserts).toHaveLength(0);
    expect(sendTempMock).not.toHaveBeenCalled();
  });

  it('audits admin.member_onboarded on the success path', async () => {
    await expect(adminOnboardMember('demo', fd({ full_name: 'Ada', email: 'a@e.com' }))).rejects.toThrow('NEXT_REDIRECT');
    expect(auditRows()).toHaveLength(1);
    expect(auditRows()[0]!.payload).toMatchObject({ action: 'admin.member_onboarded', record_id: 'new-user-1' });
  });
});

describe('adminOnboardMember — existing user reuse', () => {
  it('detects an "already registered" error, resolves via profiles, and does NOT leak a temp password', async () => {
    state.createUserResult = { data: null, error: { message: 'User already registered' } };
    state.profileLookup = { data: { id: 'existing-7' }, error: null };
    await expect(adminOnboardMember('demo', fd({ full_name: 'Ada', email: 'ada@example.com' })))
      .rejects.toThrow(/NEXT_REDIRECT:.*\/admin\/members\/existing-7/);
    // Link upserted under the EXISTING id, not a new one.
    expect(linkUpsert()!.payload).toMatchObject({ user_id: 'existing-7' });
    // No temp-password notification to an established account.
    expect(sendTempMock).not.toHaveBeenCalled();
    expect(waTempMock).not.toHaveBeenCalled();
  });

  it('returns an error when an "already registered" user cannot be resolved in profiles', async () => {
    state.createUserResult = { data: null, error: { message: 'email exists' } };
    state.profileLookup = { data: null, error: null };
    const r = await adminOnboardMember('demo', fd({ full_name: 'Ada', email: 'a@e.com' }));
    expect(r).toEqual({ error: 'Email is already taken by another account.' });
    expect(state.upserts).toHaveLength(0);
  });
});

describe('adminOnboardMember — optional membership provisioning', () => {
  it('provisions a membership + payment when a plan resolves AND a payment amount is given', async () => {
    state.planLookup = { data: { duration_months: 3 }, error: null };
    await expect(adminOnboardMember('demo', fd({ full_name: 'Ada', email: 'a@e.com', plan_id: 'plan-1', payment_amount: '15000', payment_method: 'cash' })))
      .rejects.toThrow('NEXT_REDIRECT');
    const mem = state.inserts.find((i) => i.table === 'memberships')!;
    expect(mem.payload).toMatchObject({ gym_id: 'gym-1', member_id: 'new-user-1', plan_id: 'plan-1', status: 'active' });
    const pay = state.inserts.find((i) => i.table === 'payments')!;
    expect(pay.payload).toMatchObject({ gym_id: 'gym-1', amount: 15000, payment_method: 'cash', payment_status: 'successful' });
  });

  it('falls back to cash for an invalid payment_method', async () => {
    state.planLookup = { data: { duration_months: 1 }, error: null };
    await expect(adminOnboardMember('demo', fd({ full_name: 'Ada', email: 'a@e.com', plan_id: 'p1', payment_amount: '5000', payment_method: 'gold-bars' })))
      .rejects.toThrow('NEXT_REDIRECT');
    expect(state.inserts.find((i) => i.table === 'payments')!.payload.payment_method).toBe('cash');
  });

  it('creates NO membership when a payment amount is given but the plan id does not resolve', async () => {
    state.planLookup = { data: null, error: null };
    await expect(adminOnboardMember('demo', fd({ full_name: 'Ada', email: 'a@e.com', plan_id: 'ghost', payment_amount: '15000' })))
      .rejects.toThrow('NEXT_REDIRECT');
    expect(state.inserts.some((i) => i.table === 'memberships')).toBe(false);
  });

  it('creates NO membership when a plan is chosen but the amount is zero', async () => {
    state.planLookup = { data: { duration_months: 3 }, error: null };
    await expect(adminOnboardMember('demo', fd({ full_name: 'Ada', email: 'a@e.com', plan_id: 'plan-1', payment_amount: '0' })))
      .rejects.toThrow('NEXT_REDIRECT');
    expect(state.inserts.some((i) => i.table === 'memberships')).toBe(false);
  });
});
