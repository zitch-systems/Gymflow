import { describe, it, expect, vi, beforeEach } from 'vitest';
import './_stub-server-only';

// signIn / signUp (lib/auth/actions.ts). These are the credential entry
// points, so the invariants worth locking are the security gates and the
// error-message mapping (raw Supabase errors → safe, user-friendly copy that
// doesn't leak whether an account exists):
//   - signIn: dual-dimension rate limit (IP AND email), field validation,
//     mapping of "invalid credentials" / "email not confirmed" / rate errors,
//     redirect to role home on success
//   - signUp: per-IP rate limit, required-field + NOK + waiver + password
//     validation, mapping of "already registered" / "signups disabled",
//     redirect to /login?welcome on success
// Success paths end in redirect(), which throws NEXT_REDIRECT — asserted via
// rejects.toThrow so we can see where the redirect points.

const { state, signInMock, signUpMock, profileMock, rateMock, ipMock, roleHomeMock } = vi.hoisted(() => {
  const state: {
    rateResults: Record<string, boolean>; // key prefix → allowed
    signInResult: { data: { user: { id: string } } | null; error: { message: string } | null };
    signUpResult: { error: { message: string } | null };
    profileRole: string | null;
  } = {
    rateResults: {},
    signInResult: { data: { user: { id: 'user-1' } }, error: null },
    signUpResult: { error: null },
    profileRole: 'member',
  };
  const signInMock = vi.fn(async (_args: unknown) => { void _args; return state.signInResult; });
  const signUpMock = vi.fn(async (_args: unknown) => { void _args; return state.signUpResult; });
  const profileMock = vi.fn(async () => ({ data: { role: state.profileRole } }));
  // rateLimit keyed by prefix; default allow unless a test denies a dimension.
  const rateMock = vi.fn((opts: { key: string }) => {
    const prefix = opts.key.split(':')[0];
    const allowed = state.rateResults[prefix] ?? true;
    return { ok: allowed, retryAfterSec: 30 };
  });
  const ipMock = vi.fn(async () => '1.2.3.4');
  const roleHomeMock = vi.fn((role: string | null | undefined) => `/home/${role ?? 'member'}`);
  return { state, signInMock, signUpMock, profileMock, rateMock, ipMock, roleHomeMock };
});

function makeClient() {
  return {
    auth: { signInWithPassword: signInMock, signUp: signUpMock },
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle: profileMock,
      };
    },
  };
}

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => makeClient() }));
vi.mock('@/lib/auth/dal', () => ({ roleHome: roleHomeMock }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: rateMock, clientIpFromHeaders: ipMock }));
vi.mock('@/lib/email', () => ({ sendWelcome: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/whatsapp', () => ({ waWelcome: vi.fn(async () => ({ ok: true })) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); } }));
// signUp defers welcome notifications via after(); run the callback inline so
// the test still exercises the (fire-and-forget) send path without a request
// scope. The real after() schedules it post-response.
vi.mock('next/server', () => ({ after: (fn: () => unknown) => { void fn(); } }));

import { signIn, signUp } from '@/lib/auth/actions';

function fd(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
}

const FULL_SIGNUP = {
  email: 'new@example.com',
  password: 'secret123',
  full_name: 'Ada Lovelace',
  phone: '+2348100000000',
  nok_name: 'Bem',
  nok_relationship: 'Brother',
  nok_phone: '+2348100000001',
  waiver_signed: 'on',
  gym: 'iron',
};

beforeEach(() => {
  state.rateResults = {};
  state.signInResult = { data: { user: { id: 'user-1' } }, error: null };
  state.signUpResult = { error: null };
  state.profileRole = 'member';
  signInMock.mockClear();
  signUpMock.mockClear();
  rateMock.mockClear();
});

describe('signIn — validation + rate limit', () => {
  it('requires both fields before any auth call', async () => {
    const r = await signIn(undefined, fd({ email: 'a@e.com' }));
    expect(r).toEqual({ error: 'Please fill in all fields.' });
    expect(signInMock).not.toHaveBeenCalled();
  });

  it('throttles when the IP dimension is exhausted', async () => {
    state.rateResults = { 'signin-ip': false };
    const r = await signIn(undefined, fd({ email: 'a@e.com', password: 'x' }));
    expect(r).toMatchObject({ error: expect.stringMatching(/Too many sign-in attempts/) });
    expect(signInMock).not.toHaveBeenCalled();
  });

  it('throttles when the EMAIL dimension is exhausted (even if IP is fine)', async () => {
    state.rateResults = { 'signin-email': false };
    const r = await signIn(undefined, fd({ email: 'a@e.com', password: 'x' }));
    expect(r).toMatchObject({ error: expect.stringMatching(/Too many sign-in attempts/) });
    expect(signInMock).not.toHaveBeenCalled();
  });
});

describe('signIn — error mapping', () => {
  it('maps invalid credentials to a generic message (no account-existence leak)', async () => {
    state.signInResult = { data: null, error: { message: 'Invalid login credentials' } };
    const r = await signIn(undefined, fd({ email: 'a@e.com', password: 'wrong' }));
    expect(r).toEqual({ error: 'Invalid email or password. Please try again.' });
  });

  it('maps unconfirmed-email to a confirmation prompt', async () => {
    state.signInResult = { data: null, error: { message: 'Email not confirmed' } };
    const r = await signIn(undefined, fd({ email: 'a@e.com', password: 'x' }));
    expect(r).toMatchObject({ error: expect.stringMatching(/confirmation link/) });
  });

  it('maps a provider 429/rate error to a wait message', async () => {
    state.signInResult = { data: null, error: { message: 'Request rate limit reached (429)' } };
    const r = await signIn(undefined, fd({ email: 'a@e.com', password: 'x' }));
    expect(r).toMatchObject({ error: expect.stringMatching(/Too many login attempts/) });
  });
});

describe('signIn — success', () => {
  it('redirects to the role home when no explicit redirect is given', async () => {
    state.profileRole = 'gym_owner';
    await expect(signIn(undefined, fd({ email: 'a@e.com', password: 'x' })))
      .rejects.toThrow('NEXT_REDIRECT:/home/gym_owner');
    expect(roleHomeMock).toHaveBeenCalledWith('gym_owner');
  });

  it('honours an explicit redirect target over the role home', async () => {
    await expect(signIn(undefined, fd({ email: 'a@e.com', password: 'x', redirect: '/dashboard/cards' })))
      .rejects.toThrow('NEXT_REDIRECT:/dashboard/cards');
  });
});

describe('signUp — rate limit + validation', () => {
  it('throttles per IP before validating', async () => {
    state.rateResults = { signup: false };
    const r = await signUp(undefined, fd(FULL_SIGNUP));
    expect(r).toMatchObject({ error: expect.stringMatching(/Too many signups/) });
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it('requires the core fields', async () => {
    const r = await signUp(undefined, fd({ ...FULL_SIGNUP, email: '' }));
    expect(r).toMatchObject({ error: expect.stringMatching(/complete all required fields/) });
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it('requires a full emergency contact (NOK)', async () => {
    const r = await signUp(undefined, fd({ ...FULL_SIGNUP, nok_phone: '' }));
    expect(r).toMatchObject({ error: expect.stringMatching(/Emergency contact/) });
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it('requires the waiver to be signed', async () => {
    const f = fd(FULL_SIGNUP);
    f.delete('waiver_signed');
    const r = await signUp(undefined, f);
    expect(r).toMatchObject({ error: expect.stringMatching(/agree to the terms/) });
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it('rejects a password shorter than 6 chars', async () => {
    const r = await signUp(undefined, fd({ ...FULL_SIGNUP, password: 'abc' }));
    expect(r).toMatchObject({ error: expect.stringMatching(/at least 6 characters/) });
    expect(signUpMock).not.toHaveBeenCalled();
  });
});

describe('signUp — error mapping + success', () => {
  it('maps "already registered" to a sign-in hint', async () => {
    state.signUpResult = { error: { message: 'User already registered' } };
    const r = await signUp(undefined, fd(FULL_SIGNUP));
    expect(r).toMatchObject({ error: expect.stringMatching(/already registered.*sign in/i) });
  });

  it('maps disabled signups to a contact-admin message', async () => {
    state.signUpResult = { error: { message: 'Email signups are disabled' } };
    const r = await signUp(undefined, fd(FULL_SIGNUP));
    expect(r).toMatchObject({ error: expect.stringMatching(/contact the gym admin/i) });
  });

  it('redirects to /login?welcome with the gym slug on success', async () => {
    await expect(signUp(undefined, fd(FULL_SIGNUP)))
      .rejects.toThrow(/NEXT_REDIRECT:\/login\?welcome=1&gym=iron/);
    expect(signUpMock).toHaveBeenCalledTimes(1);
  });
});
