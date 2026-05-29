import { describe, it, expect, vi, beforeEach } from 'vitest';

const { state, sendClassReminder, waClassReminder } = vi.hoisted(() => {
  type Queue = Array<{ data?: unknown; error?: { message: string } | null }>;
  const state: {
    dueQueue: Queue;
    rangeFilters: Array<{ col: string; bound: 'eq'; val: string }>;
  } = {
    dueQueue: [],
    rangeFilters: [],
  };
  const sendClassReminder = vi.fn(async () => ({ ok: true }));
  const waClassReminder = vi.fn(async () => ({ ok: true }));
  return { state, sendClassReminder, waClassReminder };
});

const adminMock = {
  from(table: string) {
    const builder: {
      select(): typeof builder;
      eq(col: string, val: string): typeof builder;
      limit(): typeof builder;
      then<T>(resolve: (v: unknown) => T): T;
    } = {
      select() { return builder; },
      eq(col: string, val: string) {
        if (table === 'class_bookings') state.rangeFilters.push({ col, bound: 'eq', val });
        return builder;
      },
      limit() { return builder; },
      then<T>(resolve: (v: unknown) => T): T {
        const next = state.dueQueue.shift() ?? { data: null, error: null };
        return resolve(next);
      },
    };
    return builder;
  },
};

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminMock }));
vi.mock('@/lib/email', () => ({ sendClassReminder }));
vi.mock('@/lib/whatsapp', () => ({ waClassReminder }));
vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn() }));

import { GET } from '@/app/api/cron/class-reminders/route';

function cronRequest(secret?: string): Request {
  const headers: Record<string, string> = {};
  if (secret) headers['authorization'] = `Bearer ${secret}`;
  return new Request('https://test.local/api/cron/class-reminders', { method: 'GET', headers });
}

const ROW = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'b-1',
  member_id: 'u-1',
  gym_id: 'gym-1',
  booking_date: new Date().toISOString().slice(0, 10),
  classes: { name: 'HIIT' },
  class_schedules: { start_time: '18:00' },
  gyms: { slug: 'demo' },
  profiles: {
    email: 'm@example.com',
    phone: '+2348000000000',
    full_name: 'Mary',
    first_name: 'Mary',
    notification_email: true,
    notification_whatsapp: true,
  },
  ...over,
});

beforeEach(() => {
  state.dueQueue = [];
  state.rangeFilters = [];
  sendClassReminder.mockClear();
  waClassReminder.mockClear();
  process.env.CRON_SECRET = 'test-cron-secret';
});

describe('GET /api/cron/class-reminders — auth', () => {
  it('401 without bearer token', async () => {
    const res = await GET(cronRequest());
    expect(res.status).toBe(401);
  });
  it('200 with x-vercel-cron-signature alt scheme', async () => {
    state.dueQueue = [{ data: [], error: null }];
    const req = new Request('https://test.local/api/cron/class-reminders', {
      method: 'GET',
      headers: { 'x-vercel-cron-signature': 'test-cron-secret' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/cron/class-reminders — query shape', () => {
  it('filters booking_date=today AND status=booked (skips cancelled / waitlisted)', async () => {
    state.dueQueue = [{ data: [], error: null }];
    await GET(cronRequest('test-cron-secret'));
    expect(state.rangeFilters).toContainEqual({ col: 'status', bound: 'eq', val: 'booked' });
    const dateFilter = state.rangeFilters.find((f) => f.col === 'booking_date');
    expect(dateFilter).toBeDefined();
    expect(dateFilter!.val).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('GET /api/cron/class-reminders — notification opt-out', () => {
  it('both channels fire for an opted-in member', async () => {
    state.dueQueue = [{ data: [ROW()], error: null }];
    await GET(cronRequest('test-cron-secret'));
    expect(sendClassReminder).toHaveBeenCalledTimes(1);
    expect(waClassReminder).toHaveBeenCalledTimes(1);
  });

  it('email-opted-out → only WhatsApp fires', async () => {
    state.dueQueue = [{ data: [ROW({ profiles: { ...ROW().profiles, notification_email: false } })], error: null }];
    await GET(cronRequest('test-cron-secret'));
    expect(sendClassReminder).not.toHaveBeenCalled();
    expect(waClassReminder).toHaveBeenCalledTimes(1);
  });

  it('both opted out → neither fires and the row counts as skipped_optout', async () => {
    state.dueQueue = [{ data: [ROW({ profiles: { ...ROW().profiles, notification_email: false, notification_whatsapp: false } })], error: null }];
    const res = await GET(cronRequest('test-cron-secret'));
    const body = (await res.json()) as { skipped_optout: number };
    expect(sendClassReminder).not.toHaveBeenCalled();
    expect(waClassReminder).not.toHaveBeenCalled();
    expect(body.skipped_optout).toBe(1);
  });

  it('null email + null phone → row skipped silently (no DB writes)', async () => {
    state.dueQueue = [{ data: [ROW({ profiles: { ...ROW().profiles, email: null, phone: null } })], error: null }];
    await GET(cronRequest('test-cron-secret'));
    expect(sendClassReminder).not.toHaveBeenCalled();
    expect(waClassReminder).not.toHaveBeenCalled();
  });
});

describe('GET /api/cron/class-reminders — summary', () => {
  it('processed + sent counts reflect successful sends', async () => {
    state.dueQueue = [{ data: [ROW(), ROW({ id: 'b-2', member_id: 'u-2' })], error: null }];
    const res = await GET(cronRequest('test-cron-secret'));
    const body = (await res.json()) as { processed: number; sent: number };
    expect(body.processed).toBe(2);
    expect(body.sent).toBe(2);
  });
});
