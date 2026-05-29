import { describe, it, expect, vi, beforeEach } from 'vitest';

// updateMemberProfile is a self-service action — members edit their own
// phone + notification toggles. The valuable invariants:
//   - signed-in gate (no auth → error, no DB writes)
//   - phone regex rejects junk
//   - the update goes through the USER-scoped client (so RLS's
//     profiles_update_no_escalation enforces auth.uid()=id + no role change)
//   - audit fires after a successful update with before+after snapshots

const { state, getSessionUser, getGymBySlug, supabaseMock, audit } = vi.hoisted(() => {
  const state: {
    user: { id: string; email?: string } | null;
    beforeRow: Record<string, unknown> | null;
    updateError: { message: string } | null;
    capturedUpdate: Record<string, unknown> | null;
    auditCalls: unknown[];
  } = {
    user: { id: 'user-1', email: 'm@example.com' },
    beforeRow: { phone: '+2348000000000', notification_email: true, notification_whatsapp: true },
    updateError: null,
    capturedUpdate: null,
    auditCalls: [],
  };
  const getSessionUser = vi.fn(async () => state.user);
  const getGymBySlug = vi.fn(async (slug: string) => ({ id: 'gym-1', slug, name: 'Demo' }));
  const audit = vi.fn(async (args: unknown) => {
    state.auditCalls.push(args);
  });
  const supabaseMock = {
    from() {
      const builder: {
        select(): typeof builder;
        update(payload: Record<string, unknown>): typeof builder;
        eq(): typeof builder;
        maybeSingle(): typeof builder;
        then<T>(resolve: (v: unknown) => T): T;
        _isSelect: boolean;
        _isUpdate: boolean;
      } = {
        _isSelect: false,
        _isUpdate: false,
        select() {
          builder._isSelect = true;
          return builder;
        },
        update(payload: Record<string, unknown>) {
          builder._isUpdate = true;
          state.capturedUpdate = payload;
          return builder;
        },
        eq() { return builder; },
        maybeSingle() { return builder; },
        then<T>(resolve: (v: unknown) => T): T {
          if (builder._isUpdate) return resolve({ error: state.updateError });
          if (builder._isSelect) return resolve({ data: state.beforeRow, error: null });
          return resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  };
  return { state, getSessionUser, getGymBySlug, supabaseMock, audit };
});

vi.mock('@/lib/auth/dal', () => ({ getSessionUser }));
vi.mock('@/lib/auth/gym', () => ({ getGymBySlug }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => supabaseMock }));
vi.mock('@/lib/audit', () => ({ audit }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { updateMemberProfile } from '@/lib/actions/member-profile';

function formData(fields: Record<string, string | null>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== null) fd.set(k, v);
  }
  return fd;
}

beforeEach(() => {
  state.user = { id: 'user-1', email: 'm@example.com' };
  state.beforeRow = { phone: '+2348000000000', notification_email: true, notification_whatsapp: true };
  state.updateError = null;
  state.capturedUpdate = null;
  state.auditCalls = [];
  getSessionUser.mockClear();
  getGymBySlug.mockClear();
  audit.mockClear();
});

describe('updateMemberProfile — auth gate', () => {
  it('rejects unauthenticated callers', async () => {
    state.user = null;
    const r = await updateMemberProfile('demo', formData({ phone: '+234800', notification_email: 'on' }));
    expect(r).toEqual({ ok: false, error: 'Not signed in' });
    // No DB writes.
    expect(state.capturedUpdate).toBeNull();
    expect(state.auditCalls).toHaveLength(0);
  });
});

describe('updateMemberProfile — phone validation', () => {
  it('rejects obviously bad phone numbers', async () => {
    const r = await updateMemberProfile('demo', formData({ phone: 'a' }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/phone/i);
    expect(state.capturedUpdate).toBeNull();
  });

  it('accepts a blank phone (member clearing it)', async () => {
    const r = await updateMemberProfile('demo', formData({ phone: '', notification_email: 'on' }));
    expect(r.ok).toBe(true);
    expect((state.capturedUpdate as { phone?: string | null }).phone).toBeNull();
  });

  it('accepts an international phone with spaces/dashes', async () => {
    const r = await updateMemberProfile('demo', formData({ phone: '+234 (816) 693-8327' }));
    expect(r.ok).toBe(true);
  });
});

describe('updateMemberProfile — avatar photo_url', () => {
  const GOOD_PHOTO = 'https://kdbb.supabase.co/storage/v1/object/public/gym-assets/user-1/avatar-123.jpg';

  it('persists a valid gym-assets public URL', async () => {
    const r = await updateMemberProfile('demo', formData({ phone: '+2348000000000', photo_url: GOOD_PHOTO }));
    expect(r.ok).toBe(true);
    expect((state.capturedUpdate as { photo_url?: string | null }).photo_url).toBe(GOOD_PHOTO);
  });

  it('treats an empty photo_url as removal (null), not an error', async () => {
    const r = await updateMemberProfile('demo', formData({ phone: '+2348000000000', photo_url: '' }));
    expect(r.ok).toBe(true);
    expect((state.capturedUpdate as { photo_url?: string | null }).photo_url).toBeNull();
  });

  it('rejects a photo_url that is not a gym-assets public URL (anti-tamper), no write', async () => {
    const r = await updateMemberProfile('demo', formData({ phone: '+2348000000000', photo_url: 'https://evil.com/track.gif' }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Invalid photo URL/);
    expect(state.capturedUpdate).toBeNull();
  });
});

describe('updateMemberProfile — toggle semantics', () => {
  it('checkboxes absent (= unchecked) opt the user OUT', async () => {
    await updateMemberProfile('demo', formData({ phone: '+2348000000000' })); // no toggles
    expect(state.capturedUpdate).toMatchObject({
      notification_email: false,
      notification_whatsapp: false,
    });
  });

  it('checkboxes present (= "on") opt the user IN', async () => {
    await updateMemberProfile(
      'demo',
      formData({ phone: '+2348000000000', notification_email: 'on', notification_whatsapp: 'on' }),
    );
    expect(state.capturedUpdate).toMatchObject({
      notification_email: true,
      notification_whatsapp: true,
    });
  });
});

describe('updateMemberProfile — audit + revalidate', () => {
  it('writes an audit entry with before + after snapshots', async () => {
    await updateMemberProfile(
      'demo',
      formData({ phone: '+2349999999999', notification_email: 'on' }),
    );
    expect(audit).toHaveBeenCalledTimes(1);
    const call = (audit as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as {
      action: string;
      table: string;
      gymId: string | null;
      actorId: string | null;
      userId: string | null;
      after: { phone: string; photo_url: string | null; notification_email: boolean; notification_whatsapp: boolean };
    };
    expect(call.action).toBe('member.profile_updated');
    expect(call.table).toBe('profiles');
    expect(call.gymId).toBe('gym-1');
    expect(call.actorId).toBe('user-1');
    expect(call.userId).toBe('user-1');
    expect(call.after).toEqual({
      phone: '+2349999999999',
      photo_url: null,
      notification_email: true,
      notification_whatsapp: false,
    });
  });

  it('forwards the DB error message verbatim when the update fails', async () => {
    state.updateError = { message: 'permission denied for table profiles' };
    const r = await updateMemberProfile(
      'demo',
      formData({ phone: '+2348000000000', notification_email: 'on' }),
    );
    expect(r).toEqual({ ok: false, error: 'permission denied for table profiles' });
    // No audit entry on failure.
    expect(audit).not.toHaveBeenCalled();
  });
});
