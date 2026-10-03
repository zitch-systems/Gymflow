import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  admin: null as unknown, responder: vi.fn(), gym: vi.fn(), platform: vi.fn(), reminder: vi.fn(),
  started: vi.fn(), succeeded: vi.fn(), failed: vi.fn(), contacts: vi.fn(), owners: vi.fn(), classesToday: vi.fn(),
}));

function query(table: string) {
  const state: { op?: string; columns?: string; ops: string[] } = { ops: [] };
  const chain = new Proxy<Record<string, unknown>>({}, {
    get(_target, prop) {
      if (prop === 'then') return (resolve: (value: unknown) => void) => resolve(h.responder(table, state));
      return (...args: unknown[]) => {
        if (prop === 'select') state.columns = String(args[0]);
        state.op = String(prop);
        state.ops.push(String(prop));
        return chain;
      };
    },
  });
  return chain;
}

vi.mock('@/lib/email/send', () => ({
  memberAppUrl: vi.fn(() => 'https://member.test/classes'), platformAppUrl: vi.fn(() => 'https://platform.test/billing'),
  sendGymEmail: h.gym, sendPlatformEmail: h.platform,
}));
vi.mock('@/lib/notify', () => ({
  deliverRenewalReminder: h.reminder,
  inSlices: async (items: unknown[], _size: number, fn: (item: unknown) => Promise<void>) => { for (const item of items) await fn(item); },
}));
vi.mock('@/lib/email/recipients', () => ({
  adminOrNull: () => h.admin, getContacts: h.contacts, getGymOwnerEmails: h.owners, GYM_EMAIL_COLUMNS: 'id,name',
}));
vi.mock('@/lib/operational-jobs', () => ({
  markJobStarted: h.started, markJobSucceeded: h.succeeded, markJobFailed: h.failed,
}));
vi.mock('@/lib/whatsapp/payments', () => ({ expireStaleIntents: vi.fn(async () => 0) }));
vi.mock('@/lib/email/templates/member', () => ({
  classesToday: h.classesToday, freezeResumed: vi.fn(),
  MEMBER_TEMPLATES: { classesToday: { template: 'classes_today', category: 'classes' }, freezeResumed: {} },
}));
vi.mock('@/lib/email/templates/platform', () => ({ trialEnded: vi.fn(), trialEnding: vi.fn() }));

const request = () => new Request('https://gymflow.test/api/cron', { headers: { authorization: 'Bearer expected-secret' } });

describe('notifications cron correctness controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CRON_SECRET', 'expected-secret');
    vi.stubEnv('RESEND_API_KEY', 'test-only');
    h.admin = { from: (table: string) => query(table), rpc: vi.fn(async () => ({ data: null, error: null })) };
    h.responder.mockReturnValue({ data: [], error: null });
    h.started.mockResolvedValue(undefined);
    h.succeeded.mockResolvedValue(undefined);
    h.failed.mockResolvedValue(undefined);
    h.contacts.mockResolvedValue([]);
    h.owners.mockResolvedValue([]);
    h.gym.mockResolvedValue({ ok: true });
    h.platform.mockResolvedValue({ ok: true });
    h.classesToday.mockImplementation((facts) => ({ subject: 'Classes', html: JSON.stringify(facts.classes), text: JSON.stringify(facts.classes) }));
  });

  it('returns 500, records failure, and does not record success for mandatory DB failure', async () => {
    h.responder.mockImplementation((table: string) => table === 'gyms'
      ? { data: null, error: { message: 'database unavailable' } } : { data: [], error: null });
    const { GET } = await import('../app/api/cron/route');
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(h.failed).toHaveBeenCalledOnce();
    expect(h.succeeded).not.toHaveBeenCalled();
    expect(h.gym).not.toHaveBeenCalled();
  });

  it('reports a safe warning count for an optional branch failure and still succeeds', async () => {
    let gymCalls = 0;
    h.responder.mockImplementation((table: string) => {
      if (table === 'gyms' && ++gymCalls === 2) return { data: null, error: { message: 'sensitive-row-data' } };
      return { data: [], error: null };
    });
    const { GET } = await import('../app/api/cron/route');
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, bestEffortWarnings: 1 });
    expect(h.succeeded).toHaveBeenCalledOnce();
    expect(h.failed).not.toHaveBeenCalled();
  });

  it('requests strict recipient lookups for optional email branches', async () => {
    h.contacts.mockRejectedValueOnce(new Error('recipient database unavailable'));
    h.responder.mockImplementation((table: string) => {
      if (table === 'class_bookings') return { data: [
        { member_id: 'member-1', gym_id: 'gym-a', class_schedule_id: 'sched-a' },
      ], error: null };
      if (table === 'class_schedules') return { data: [
        { id: 'sched-a', gym_id: 'gym-a', class_id: 'class-a', start_time: '08:00:00', room: null },
      ], error: null };
      if (table === 'classes') return { data: [
        { id: 'class-a', gym_id: 'gym-a', name: 'Yoga', instructor: null },
      ], error: null };
      return { data: [], error: null };
    });
    const { GET } = await import('../app/api/cron/route');
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ bestEffortWarnings: 1, classDigestsSent: 0 });
    expect(h.contacts).toHaveBeenCalledWith(expect.anything(), ['member-1'], { throwOnError: true });
  });

  it('warns on provider email failures but not intentional skips', async () => {
    h.responder.mockImplementation((table: string, state: { columns?: string }) => {
      if (table === 'class_bookings') return { data: [
        { member_id: 'member-1', gym_id: 'gym-a', class_schedule_id: 'sched-a' },
        { member_id: 'member-2', gym_id: 'gym-a', class_schedule_id: 'sched-b' },
      ], error: null };
      if (table === 'class_schedules') return { data: [
        { id: 'sched-a', gym_id: 'gym-a', class_id: 'class-a', start_time: '08:00:00', room: null },
        { id: 'sched-b', gym_id: 'gym-a', class_id: 'class-b', start_time: '09:00:00', room: null },
      ], error: null };
      if (table === 'classes') return { data: [
        { id: 'class-a', gym_id: 'gym-a', name: 'Yoga', instructor: null },
        { id: 'class-b', gym_id: 'gym-a', name: 'Spin', instructor: null },
      ], error: null };
      if (table === 'gyms' && state.columns === 'id,name') return { data: [{ id: 'gym-a', name: 'Gym A' }], error: null };
      return { data: [], error: null };
    });
    h.contacts.mockResolvedValue([
      { id: 'member-1', email: 'one@test.invalid', fullName: 'One', wantsEmail: true },
      { id: 'member-2', email: 'two@test.invalid', fullName: 'Two', wantsEmail: true },
    ]);
    h.gym
      .mockResolvedValueOnce({ ok: false, error: 'provider unavailable' })
      .mockResolvedValueOnce({ ok: false, skipped: true });
    const { GET } = await import('../app/api/cron/route');
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ bestEffortWarnings: 1, classDigestsSent: 0 });
  });

  it('does not write the renewal dedupe row until contact prerequisites load', async () => {
    let notificationInsert = false;
    h.responder.mockImplementation((table: string, state: { ops: string[] }) => {
      if (table === 'member_subscriptions') return { data: [
        { id: 'sub-1', member_id: 'member-1', gym_id: 'gym-a', end_date: '2026-10-05' },
      ], error: null };
      if (table === 'profiles') return { data: null, error: { message: 'lookup unavailable' } };
      if (table === 'notifications' && state.ops.includes('insert')) notificationInsert = true;
      return { data: [], error: null };
    });
    const { GET } = await import('../app/api/cron/route');
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(notificationInsert).toBe(false);
    expect(h.failed).toHaveBeenCalledOnce();
  });

  it('sends separate same-member digests containing only classes from their own gym', async () => {
    h.responder.mockImplementation((table: string, state: { columns?: string }) => {
      if (table === 'class_bookings') return { data: [
        { member_id: 'member-1', gym_id: 'gym-a', class_schedule_id: 'sched-a' },
        { member_id: 'member-1', gym_id: 'gym-b', class_schedule_id: 'sched-b' },
      ], error: null };
      if (table === 'class_schedules') return { data: [
        { id: 'sched-a', gym_id: 'gym-a', class_id: 'class-a', start_time: '08:00:00', room: 'A' },
        { id: 'sched-b', gym_id: 'gym-b', class_id: 'class-b', start_time: '09:00:00', room: 'B' },
      ], error: null };
      if (table === 'classes') return { data: [
        { id: 'class-a', gym_id: 'gym-a', name: 'Yoga A', instructor: null },
        { id: 'class-b', gym_id: 'gym-b', name: 'Spin B', instructor: null },
      ], error: null };
      if (table === 'gyms' && state.columns === 'id,name') return { data: [
        { id: 'gym-a', name: 'Gym A' }, { id: 'gym-b', name: 'Gym B' },
      ], error: null };
      return { data: [], error: null };
    });
    h.contacts.mockResolvedValue([{ id: 'member-1', email: 'member@test.invalid', fullName: 'Member', wantsEmail: true }]);
    const { GET } = await import('../app/api/cron/route');
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(h.gym).toHaveBeenCalledTimes(2);
    const sends = h.gym.mock.calls.map(([arg]) => arg);
    expect(sends.map((s) => s.idempotencyKey).sort()).toEqual(expect.arrayContaining([
      expect.stringContaining('member-1:gym-a:'), expect.stringContaining('member-1:gym-b:'),
    ]));
    expect(sends.find((s) => s.gym.id === 'gym-a').html).toContain('Yoga A');
    expect(sends.find((s) => s.gym.id === 'gym-a').html).not.toContain('Spin B');
    expect(sends.find((s) => s.gym.id === 'gym-b').html).toContain('Spin B');
    expect(sends.find((s) => s.gym.id === 'gym-b').html).not.toContain('Yoga A');
  });
});
