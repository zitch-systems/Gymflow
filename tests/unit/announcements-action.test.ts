import { describe, it, expect, vi, beforeEach } from 'vitest';
import './_stub-server-only';

// sendGymAnnouncement (lib/actions/announcements.ts). Broadcasts a message
// to every active member of a gym, persists one notifications row per
// recipient (for a future in-app inbox), and fans out email + WhatsApp via
// after() so the admin's response isn't blocked on N provider calls.
// Invariants worth locking:
//   - manager auth required
//   - subject + message required, length-capped (120 / 2000)
//   - channel param is constrained to email | whatsapp | both, defaulting
//     to email on anything else (anti-tamper)
//   - the member fan-out is scoped to gym_id + is_active + status=active
//   - one notifications row per member, type='announcement'
//   - sends honour NDPR opt-out flags AND skip members missing the channel
//     identifier (no email = no email send, no phone = no WhatsApp)
//   - email/whatsapp routing matches the channel choice
//   - audit fires with admin.announcement_sent and the recipient count

type MemberFixture = {
  user_id: string;
  email: string | null;
  phone: string | null;
  notification_email: boolean | null;
  notification_whatsapp: boolean | null;
};

const { state, requireManagerMock, getSessionMock, auditMock, sendEmailMock, sendWaMock, afterCalls } = vi.hoisted(() => {
  const state: {
    members: MemberFixture[];
    // (gym_id, user_id, tag) rows in the member_tags table for this gym
    tagAssignments: Array<{ user_id: string; tag: string }>;
    insertedNotifications: Array<Record<string, unknown>>;
  } = { members: [], tagAssignments: [], insertedNotifications: [] };
  const requireManagerMock = vi.fn(async (slug: string) => { void slug; return { role: 'owner', gym: { id: 'gym-1', name: 'Iron Temple' } }; });
  const getSessionMock = vi.fn(async () => ({ id: 'actor-1' }));
  const auditMock = vi.fn(async (_payload: Record<string, unknown>) => { void _payload; });
  const sendEmailMock = vi.fn(async () => ({ ok: true }));
  const sendWaMock = vi.fn(async () => ({ ok: true }));
  const afterCalls: Array<() => Promise<void>> = [];
  return { state, requireManagerMock, getSessionMock, auditMock, sendEmailMock, sendWaMock, afterCalls };
});

function makeAdmin() {
  return {
    from(table: string) {
      // Track .eq() filter values so the member_tags query can filter by tag.
      const eqs: Record<string, unknown> = {};
      const builder = {
        _selectOpts: undefined as { count?: string; head?: boolean } | undefined,
        select(_cols?: string, opts?: { count?: string; head?: boolean }) {
          void _cols;
          builder._selectOpts = opts;
          return builder;
        },
        eq(col: string, val: unknown) { eqs[col] = val; return builder; },
        // Awaited directly (no maybeSingle); count head mode returns { count }
        // when select() was called with head:true.
        then<T>(resolve: (v: { data: unknown; count?: number | null; error: null }) => T): T {
          if (table === 'gym_member_links') {
            if (builder._selectOpts?.head) {
              return resolve({ data: null, count: state.members.length, error: null });
            }
            const rows = state.members.map((m) => ({
              user_id: m.user_id,
              profiles: {
                email: m.email,
                phone: m.phone,
                full_name: 'Member ' + m.user_id,
                first_name: 'M',
                notification_email: m.notification_email,
                notification_whatsapp: m.notification_whatsapp,
              },
            }));
            return resolve({ data: rows, count: null, error: null });
          }
          if (table === 'member_tags') {
            const wantedTag = eqs.tag as string | undefined;
            const rows = state.tagAssignments
              .filter((a) => wantedTag == null || a.tag === wantedTag)
              .map((a) => ({ user_id: a.user_id }));
            return resolve({ data: rows, count: null, error: null });
          }
          return resolve({ data: null, count: null, error: null });
        },
        insert(rows: unknown) {
          if (table === 'notifications') {
            for (const r of rows as Array<Record<string, unknown>>) state.insertedNotifications.push(r);
          }
          return Promise.resolve({ error: null });
        },
      };
      return builder;
    },
  };
}

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => makeAdmin() }));
vi.mock('@/lib/auth/gym', () => ({ requireManager: requireManagerMock }));
vi.mock('@/lib/auth/dal', () => ({ getSessionUser: getSessionMock }));
vi.mock('@/lib/audit', () => ({ audit: auditMock }));
vi.mock('@/lib/email', () => ({ sendAnnouncement: sendEmailMock }));
vi.mock('@/lib/whatsapp', () => ({ waAnnouncement: sendWaMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// after() runs the deferred fan-out; capture the callback and invoke it
// synchronously in the test so we can assert what was sent.
vi.mock('next/server', () => ({
  after: (fn: () => Promise<void>) => { afterCalls.push(fn); },
}));

import { sendGymAnnouncement } from '@/lib/actions/announcements';

function fd(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
}

beforeEach(() => {
  state.members = [];
  state.tagAssignments = [];
  state.insertedNotifications = [];
  afterCalls.length = 0;
  requireManagerMock.mockClear();
  auditMock.mockClear();
  sendEmailMock.mockClear();
  sendWaMock.mockClear();
});

describe('sendGymAnnouncement — authz + validation', () => {
  it('requires a manager session before any DB read', async () => {
    requireManagerMock.mockRejectedValueOnce(new Error('redirect'));
    await expect(sendGymAnnouncement('demo', fd({ subject: 'Hi', message: 'm' }))).rejects.toThrow();
    expect(state.insertedNotifications).toHaveLength(0);
  });

  it('rejects an empty subject', async () => {
    const r = await sendGymAnnouncement('demo', fd({ subject: '', message: 'm' }));
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Subject/) });
    expect(state.insertedNotifications).toHaveLength(0);
  });

  it('rejects an empty message', async () => {
    const r = await sendGymAnnouncement('demo', fd({ subject: 's', message: '' }));
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Message/) });
  });

  it('rejects subject over 120 chars', async () => {
    const r = await sendGymAnnouncement('demo', fd({ subject: 'x'.repeat(121), message: 'm' }));
    expect(r.ok).toBe(false);
  });

  it('rejects message over 2000 chars', async () => {
    const r = await sendGymAnnouncement('demo', fd({ subject: 's', message: 'x'.repeat(2001) }));
    expect(r.ok).toBe(false);
  });

  it('returns an error when the gym has no active members', async () => {
    state.members = [];
    const r = await sendGymAnnouncement('demo', fd({ subject: 's', message: 'm' }));
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/No active members/) });
    expect(state.insertedNotifications).toHaveLength(0);
  });
});

describe('sendGymAnnouncement — channel routing + opt-out respect', () => {
  const ALL_IN: MemberFixture[] = [
    { user_id: 'u1', email: 'a@e.com', phone: '+1', notification_email: true, notification_whatsapp: true },
    { user_id: 'u2', email: 'b@e.com', phone: '+2', notification_email: true, notification_whatsapp: true },
  ];

  it('default channel is email; persists one notifications row per member', async () => {
    state.members = ALL_IN;
    const r = await sendGymAnnouncement('demo', fd({ subject: 'Closed Monday', message: 'See you Tuesday' }));
    expect(r).toMatchObject({ ok: true, recipients: 2 });
    expect(state.insertedNotifications).toHaveLength(2);
    expect(state.insertedNotifications[0]).toMatchObject({
      gym_id: 'gym-1',
      user_id: 'u1',
      title: 'Closed Monday',
      type: 'announcement',
      channel: 'email',
    });
    // run the after() fan-out
    for (const fn of afterCalls) await fn();
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    expect(sendWaMock).not.toHaveBeenCalled();
  });

  it('whatsapp channel hits only the WhatsApp sender', async () => {
    state.members = ALL_IN;
    await sendGymAnnouncement('demo', fd({ subject: 's', message: 'm', channel: 'whatsapp' }));
    for (const fn of afterCalls) await fn();
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(sendWaMock).toHaveBeenCalledTimes(2);
  });

  it('both channel fans out via both senders', async () => {
    state.members = ALL_IN;
    await sendGymAnnouncement('demo', fd({ subject: 's', message: 'm', channel: 'both' }));
    for (const fn of afterCalls) await fn();
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    expect(sendWaMock).toHaveBeenCalledTimes(2);
  });

  it('coerces an unknown channel back to email (anti-tamper)', async () => {
    state.members = ALL_IN;
    await sendGymAnnouncement('demo', fd({ subject: 's', message: 'm', channel: 'sms' }));
    for (const fn of afterCalls) await fn();
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    expect(sendWaMock).not.toHaveBeenCalled();
  });

  it('skips email for members who opted out (notification_email=false)', async () => {
    state.members = [
      { user_id: 'u1', email: 'a@e.com', phone: '+1', notification_email: false, notification_whatsapp: true },
      { user_id: 'u2', email: 'b@e.com', phone: '+2', notification_email: true, notification_whatsapp: true },
    ];
    await sendGymAnnouncement('demo', fd({ subject: 's', message: 'm' }));
    for (const fn of afterCalls) await fn();
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it('skips a channel when the member has no email/phone, without erroring', async () => {
    state.members = [
      { user_id: 'u1', email: null, phone: '+1', notification_email: true, notification_whatsapp: true },
      { user_id: 'u2', email: 'b@e.com', phone: null, notification_email: true, notification_whatsapp: true },
    ];
    await sendGymAnnouncement('demo', fd({ subject: 's', message: 'm', channel: 'both' }));
    for (const fn of afterCalls) await fn();
    expect(sendEmailMock).toHaveBeenCalledTimes(1); // only u2 has email
    expect(sendWaMock).toHaveBeenCalledTimes(1);    // only u1 has phone
  });

  it('still persists an in-app notification row even when the channel send is skipped (opt-out)', async () => {
    // The in-app inbox is the source of truth — opt-outs gate the OUTBOUND
    // channel only.
    state.members = [
      { user_id: 'u1', email: 'a@e.com', phone: null, notification_email: false, notification_whatsapp: false },
    ];
    const r = await sendGymAnnouncement('demo', fd({ subject: 's', message: 'm', channel: 'both' }));
    expect(r.ok).toBe(true);
    expect(state.insertedNotifications).toHaveLength(1);
    for (const fn of afterCalls) await fn();
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(sendWaMock).not.toHaveBeenCalled();
  });

  it('audits admin.announcement_sent with the recipient count and channel', async () => {
    state.members = [{ user_id: 'u1', email: 'a@e.com', phone: '+1', notification_email: true, notification_whatsapp: true }];
    await sendGymAnnouncement('demo', fd({ subject: 'Hello', message: 'm', channel: 'both' }));
    expect(auditMock).toHaveBeenCalledTimes(1);
  });
});

describe('sendGymAnnouncement — tag-targeted broadcasts', () => {
  const THREE_MEMBERS: MemberFixture[] = [
    { user_id: 'u1', email: 'a@e.com', phone: '+1', notification_email: true, notification_whatsapp: true },
    { user_id: 'u2', email: 'b@e.com', phone: '+2', notification_email: true, notification_whatsapp: true },
    { user_id: 'u3', email: 'c@e.com', phone: '+3', notification_email: true, notification_whatsapp: true },
  ];

  it('narrows the fan-out to members carrying the chosen tag', async () => {
    state.members = THREE_MEMBERS;
    state.tagAssignments = [
      { user_id: 'u1', tag: 'VIP' },
      { user_id: 'u3', tag: 'VIP' },
      { user_id: 'u2', tag: 'Trial' },
    ];
    const r = await sendGymAnnouncement('demo', fd({ subject: 's', message: 'm', tag: 'VIP' }));
    expect(r).toMatchObject({ ok: true, recipients: 2 });
    expect(state.insertedNotifications.map((n) => n.user_id).sort()).toEqual(['u1', 'u3']);
    for (const fn of afterCalls) await fn();
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a tag value that does not match the safe regex (anti-injection)', async () => {
    state.members = THREE_MEMBERS;
    state.tagAssignments = [{ user_id: 'u1', tag: 'VIP' }];
    const r = await sendGymAnnouncement('demo', fd({ subject: 's', message: 'm', tag: "VIP'); drop --" }));
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Invalid tag/) });
    expect(state.insertedNotifications).toHaveLength(0);
  });

  it('errors when no members carry the requested tag', async () => {
    state.members = THREE_MEMBERS;
    state.tagAssignments = [{ user_id: 'u2', tag: 'Trial' }];
    const r = await sendGymAnnouncement('demo', fd({ subject: 's', message: 'm', tag: 'VIP' }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/VIP/);
    expect(state.insertedNotifications).toHaveLength(0);
  });

  it('records the tag value on the audit payload', async () => {
    state.members = THREE_MEMBERS;
    state.tagAssignments = [{ user_id: 'u1', tag: 'VIP' }];
    await sendGymAnnouncement('demo', fd({ subject: 's', message: 'm', tag: 'VIP' }));
    expect(auditMock).toHaveBeenCalledTimes(1);
    const call = auditMock.mock.calls[0]?.[0] as unknown as { after: { tag: string | null; recipients: number } };
    expect(call.after.tag).toBe('VIP');
    expect(call.after.recipients).toBe(1);
  });

  it('excludes a tagged user who is no longer an active member', async () => {
    // u4 carries the tag but is absent from the active-members result
    // (member_tags rows survive a member going inactive). The send must
    // intersect against active members and skip u4.
    state.members = [
      { user_id: 'u1', email: 'a@e.com', phone: '+1', notification_email: true, notification_whatsapp: true },
    ];
    state.tagAssignments = [
      { user_id: 'u1', tag: 'VIP' },
      { user_id: 'u4', tag: 'VIP' },
    ];
    const r = await sendGymAnnouncement('demo', fd({ subject: 's', message: 'm', tag: 'VIP' }));
    expect(r).toMatchObject({ ok: true, recipients: 1 });
    expect(state.insertedNotifications.map((n) => n.user_id)).toEqual(['u1']);
  });

  it('treats an empty tag as the default all-members broadcast (tag=null in audit)', async () => {
    state.members = THREE_MEMBERS;
    state.tagAssignments = [{ user_id: 'u1', tag: 'VIP' }];
    const r = await sendGymAnnouncement('demo', fd({ subject: 's', message: 'm', tag: '' }));
    expect(r).toMatchObject({ ok: true, recipients: 3 });
    const call = auditMock.mock.calls[0]?.[0] as unknown as { after: { tag: string | null } };
    expect(call.after.tag).toBeNull();
  });
});
