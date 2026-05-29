import { describe, it, expect, vi, beforeEach } from 'vitest';

// Class booking action tests — bookClass + cancelBooking. Particularly worth
// pinning because:
//   - waitlist promotion was an IDOR fix earlier (it must scope to gym_id)
//   - the re-activate-cancelled-row path is subtle (UPDATE not INSERT)
//   - capacity vs waitlisted depends on an exact-count query

const { state, requireMember, getSessionUser, userSupabase, adminSupabase } = vi.hoisted(() => {
  type Queue = Array<{ data?: unknown; error?: { message: string } | null; count?: number | null }>;
  const state: {
    userQueue: Map<string, Queue>;
    adminQueue: Map<string, Queue>;
    sessionUser: { id: string } | null;
    inserts: Array<{ table: string; payload: unknown; client: 'user' | 'admin' }>;
    updates: Array<{ table: string; payload: unknown; client: 'user' | 'admin'; filters: Array<{ col: string; val: string }> }>;
  } = {
    userQueue: new Map(),
    adminQueue: new Map(),
    sessionUser: { id: 'member-1' },
    inserts: [],
    updates: [],
  };
  const requireMember = vi.fn(async (slug: string) => {
    if (!state.sessionUser) throw new Error('redirect');
    return { user: state.sessionUser, gym: { id: 'gym-1', slug, name: 'Demo' }, link: {} };
  });
  const getSessionUser = vi.fn(async () => state.sessionUser);

  function makeClient(queue: typeof state.userQueue, kind: 'user' | 'admin') {
    return {
      from(table: string) {
        const builder: {
          select(s?: string, opts?: unknown): typeof builder;
          insert(p: unknown): typeof builder;
          update(p: unknown): typeof builder;
          eq(col: string, val: string): typeof builder;
          order(): typeof builder;
          limit(): typeof builder;
          maybeSingle(): typeof builder;
          then<T>(resolve: (v: unknown) => T): T;
          _isInsert: boolean;
          _isUpdate: boolean;
          _filters: Array<{ col: string; val: string }>;
          _insertPayload: unknown;
          _updatePayload: unknown;
        } = {
          _isInsert: false,
          _isUpdate: false,
          _filters: [],
          _insertPayload: null,
          _updatePayload: null,
          select() { return builder; },
          insert(p: unknown) {
            builder._isInsert = true;
            builder._insertPayload = p;
            return builder;
          },
          update(p: unknown) {
            builder._isUpdate = true;
            builder._updatePayload = p;
            return builder;
          },
          eq(col: string, val: string) {
            builder._filters.push({ col, val });
            return builder;
          },
          order() { return builder; },
          limit() { return builder; },
          maybeSingle() { return builder; },
          then<T>(resolve: (v: unknown) => T): T {
            if (builder._isInsert) {
              state.inserts.push({ table, payload: builder._insertPayload, client: kind });
              const q = queue.get(table);
              return resolve(q?.shift() ?? { data: { id: 'new-id' }, error: null });
            }
            if (builder._isUpdate) {
              state.updates.push({ table, payload: builder._updatePayload, client: kind, filters: builder._filters });
              const q = queue.get(table);
              return resolve(q?.shift() ?? { data: null, error: null });
            }
            const q = queue.get(table);
            return resolve(q?.shift() ?? { data: null, error: null });
          },
        };
        return builder;
      },
    };
  }

  const userSupabase = makeClient(state.userQueue, 'user');
  const adminSupabase = makeClient(state.adminQueue, 'admin');
  return { state, requireMember, getSessionUser, userSupabase, adminSupabase };
});

const { sendWaitlistJoined, sendWaitlistPromoted, waWaitlistJoined, waWaitlistPromoted } = vi.hoisted(() => ({
  sendWaitlistJoined: vi.fn(async () => ({ ok: true })),
  sendWaitlistPromoted: vi.fn(async () => ({ ok: true })),
  waWaitlistJoined: vi.fn(async () => ({ ok: true })),
  waWaitlistPromoted: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@/lib/auth/gym', () => ({ requireMember, requireStaff: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ getSessionUser }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => userSupabase }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminSupabase }));
vi.mock('@/lib/audit', () => ({ audit: vi.fn(async () => {}) }));
vi.mock('@/lib/email', () => ({ sendWaitlistJoined, sendWaitlistPromoted }));
vi.mock('@/lib/whatsapp', () => ({ waWaitlistJoined, waWaitlistPromoted }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { bookClass, cancelBooking } from '@/lib/actions/classes';

beforeEach(() => {
  // CRITICAL: clear in place — reassigning (state.userQueue = new Map()) breaks
  // the closure reference captured inside makeClient() at vi.hoisted time.
  state.userQueue.clear();
  state.adminQueue.clear();
  state.sessionUser = { id: 'member-1' };
  state.inserts.length = 0;
  state.updates.length = 0;
  requireMember.mockClear();
  getSessionUser.mockClear();
  sendWaitlistJoined.mockClear();
  sendWaitlistPromoted.mockClear();
  waWaitlistJoined.mockClear();
  waWaitlistPromoted.mockClear();
});

describe('bookClass — guards', () => {
  it('returns "Class not found" when the schedule lookup is empty', async () => {
    state.userQueue.set('class_schedules', [{ data: null, error: null }]);
    const r = await bookClass('demo', 'sched-1', '2026-05-30');
    expect(r).toEqual({ ok: false, error: 'Class not found' });
    expect(state.inserts).toHaveLength(0);
  });

  it('returns "already have a spot" when an active booking exists', async () => {
    state.userQueue.set('class_schedules', [
      { data: { id: 'sched-1', class_id: 'cls-1', gym_id: 'gym-1', classes: { max_capacity: 20 } }, error: null },
    ]);
    state.userQueue.set('class_bookings', [
      { data: { id: 'b-1', status: 'booked' }, error: null },
    ]);
    const r = await bookClass('demo', 'sched-1', '2026-05-30');
    expect(r).toEqual({ ok: false, error: 'You already have a spot for this class' });
    expect(state.inserts).toHaveLength(0);
    expect(state.updates).toHaveLength(0);
  });
});

describe('bookClass — capacity vs waitlist', () => {
  it('inserts a "booked" row when under capacity', async () => {
    state.userQueue.set('class_schedules', [
      { data: { id: 'sched-1', class_id: 'cls-1', gym_id: 'gym-1', classes: { max_capacity: 20 } }, error: null },
    ]);
    state.userQueue.set('class_bookings', [
      { data: null, error: null },                                   // no existing
      { data: null, error: null, count: 5 },                         // 5 < 20 → seat available
      { data: { id: 'new-b' }, error: null },                        // insert returns
    ]);
    const r = await bookClass('demo', 'sched-1', '2026-05-30');
    expect(r).toEqual({ ok: true, bookingId: 'new-b', waitlisted: false });
    const ins = state.inserts.find((i) => i.table === 'class_bookings');
    expect((ins?.payload as { status: string }).status).toBe('booked');
  });

  it('inserts a "waitlisted" row when at capacity', async () => {
    state.userQueue.set('class_schedules', [
      { data: { id: 'sched-1', class_id: 'cls-1', gym_id: 'gym-1', classes: { max_capacity: 20 } }, error: null },
    ]);
    state.userQueue.set('class_bookings', [
      { data: null, error: null },                                   // no existing
      { data: null, error: null, count: 20 },                        // full
      { data: { id: 'wl-b' }, error: null },
    ]);
    const r = await bookClass('demo', 'sched-1', '2026-05-30');
    expect(r).toEqual({ ok: true, bookingId: 'wl-b', waitlisted: true });
    const ins = state.inserts.find((i) => i.table === 'class_bookings');
    expect((ins?.payload as { status: string }).status).toBe('waitlisted');
  });

  it('classes with NULL capacity never go to waitlist (open class)', async () => {
    state.userQueue.set('class_schedules', [
      { data: { id: 'sched-1', class_id: 'cls-1', gym_id: 'gym-1', classes: { max_capacity: null } }, error: null },
    ]);
    state.userQueue.set('class_bookings', [
      { data: null, error: null },                                   // no existing
      { data: null, error: null, count: 9999 },                      // many bookings, capacity is null
      { data: { id: 'open-b' }, error: null },
    ]);
    const r = await bookClass('demo', 'sched-1', '2026-05-30');
    expect(r.ok).toBe(true);
    expect(r.ok && r.waitlisted).toBe(false);
  });
});

describe('bookClass — re-activate a cancelled row', () => {
  it('UPDATEs the previously-cancelled booking instead of INSERTing a new one', async () => {
    state.userQueue.set('class_schedules', [
      { data: { id: 'sched-1', class_id: 'cls-1', gym_id: 'gym-1', classes: { max_capacity: 20 } }, error: null },
    ]);
    state.userQueue.set('class_bookings', [
      { data: { id: 'old-cancelled', status: 'cancelled' }, error: null },
      { data: null, error: null, count: 5 },
    ]);
    const r = await bookClass('demo', 'sched-1', '2026-05-30');
    expect(r).toEqual({ ok: true, bookingId: 'old-cancelled', waitlisted: false });

    // No INSERT — only an UPDATE on the existing row.
    expect(state.inserts.filter((i) => i.table === 'class_bookings')).toHaveLength(0);
    const upd = state.updates.find((u) => u.table === 'class_bookings');
    expect(upd).toBeDefined();
    expect((upd?.payload as { status: string; cancelled_at: null }).status).toBe('booked');
    expect((upd?.payload as { cancelled_at: null }).cancelled_at).toBeNull();
  });
});

describe('cancelBooking — auth + ownership', () => {
  it('rejects when not signed in', async () => {
    state.sessionUser = null;
    const r = await cancelBooking('demo', 'b-1');
    expect(r).toEqual({ ok: false, error: 'Not signed in' });
    expect(state.updates).toHaveLength(0);
  });

  it('the cancel UPDATE scopes by member_id — a member can\'t cancel another member\'s booking', async () => {
    state.userQueue.set('class_bookings', [
      { data: { id: 'b-1', status: 'waitlisted', class_schedule_id: 's-1', booking_date: '2026-05-30', gym_id: 'gym-1' }, error: null },
    ]);
    await cancelBooking('demo', 'b-1');
    const cancelUpd = state.updates.find((u) => u.client === 'user' && u.table === 'class_bookings');
    expect(cancelUpd).toBeDefined();
    expect(cancelUpd?.filters).toContainEqual({ col: 'member_id', val: 'member-1' });
  });
});

describe('cancelBooking — waitlist promotion', () => {
  it('cancelling a "booked" row promotes the oldest "waitlisted" via the ADMIN client (RLS bypass)', async () => {
    state.userQueue.set('class_bookings', [
      { data: { id: 'b-1', status: 'booked', class_schedule_id: 's-1', booking_date: '2026-05-30', gym_id: 'gym-1' }, error: null },
    ]);
    state.adminQueue.set('class_bookings', [
      { data: { id: 'next-wl' }, error: null },   // SELECT for the next waitlisted
    ]);

    await cancelBooking('demo', 'b-1');

    // Two updates: the user-scoped cancel + the admin-scoped promotion.
    const adminPromotion = state.updates.find((u) => u.client === 'admin' && u.table === 'class_bookings');
    expect(adminPromotion).toBeDefined();
    expect((adminPromotion?.payload as { status: string }).status).toBe('booked');
    // CRITICAL: the promotion update must include gym_id (the IDOR fix)
    expect(adminPromotion?.filters).toContainEqual({ col: 'gym_id', val: 'gym-1' });
  });

  it('cancelling a "waitlisted" row does NOT promote (no seat opened up)', async () => {
    state.userQueue.set('class_bookings', [
      { data: { id: 'b-1', status: 'waitlisted', class_schedule_id: 's-1', booking_date: '2026-05-30', gym_id: 'gym-1' }, error: null },
    ]);

    await cancelBooking('demo', 'b-1');

    // Only the user-scoped cancel update fires; no admin client invoked.
    const adminUpdates = state.updates.filter((u) => u.client === 'admin');
    expect(adminUpdates).toHaveLength(0);
  });

  it('with no waitlisted members to promote, nothing crashes — best-effort', async () => {
    state.userQueue.set('class_bookings', [
      { data: { id: 'b-1', status: 'booked', class_schedule_id: 's-1', booking_date: '2026-05-30', gym_id: 'gym-1' }, error: null },
    ]);
    state.adminQueue.set('class_bookings', [
      { data: null, error: null }, // no one on the waitlist
    ]);

    const r = await cancelBooking('demo', 'b-1');
    expect(r).toEqual({ ok: true });
    // No promotion update because the SELECT returned null.
    const adminUpdates = state.updates.filter((u) => u.client === 'admin');
    expect(adminUpdates).toHaveLength(0);
  });
});

describe('cancelBooking — waitlist promotion notification', () => {
  // Shared promotion fixtures: a cancelled "booked" row, a waitlisted member
  // ready to be promoted, then the joined profile + schedule + gym lookups
  // the notifyWaitlistPromoted helper does in Promise.all order.
  function setupPromotion(profile: Record<string, unknown> | null) {
    state.userQueue.set('class_bookings', [
      { data: { id: 'b-1', status: 'booked', class_schedule_id: 's-1', booking_date: '2026-05-30', gym_id: 'gym-1' }, error: null },
    ]);
    state.adminQueue.set('class_bookings', [
      { data: { id: 'next-wl', member_id: 'promoted-1' }, error: null },
    ]);
    state.adminQueue.set('profiles', [{ data: profile, error: null }]);
    state.adminQueue.set('class_schedules', [
      { data: { start_time: '18:00', classes: { name: 'HIIT' } }, error: null },
    ]);
    state.adminQueue.set('gyms', [{ data: { slug: 'demo' }, error: null }]);
  }

  it('fires email + WhatsApp when the promoted member is opted into both', async () => {
    setupPromotion({
      email: 'promoted@example.com',
      phone: '+2348000000000',
      full_name: 'Promoted Member',
      first_name: 'Promoted',
      notification_email: true,
      notification_whatsapp: true,
    });

    await cancelBooking('demo', 'b-1');

    expect(sendWaitlistPromoted).toHaveBeenCalledTimes(1);
    expect(waWaitlistPromoted).toHaveBeenCalledTimes(1);
    const emailCall = sendWaitlistPromoted.mock.calls[0] as unknown as [string, { name: string; className: string; classDate: string }];
    expect(emailCall[0]).toBe('promoted@example.com');
    expect(emailCall[1]).toMatchObject({
      name: 'Promoted Member',
      className: 'HIIT',
      classDate: '2026-05-30',
    });
  });

  it('honours notification_email=false (NDPR opt-out) — no email, WhatsApp still fires', async () => {
    setupPromotion({
      email: 'promoted@example.com',
      phone: '+2348000000000',
      full_name: 'Promoted',
      first_name: 'Promoted',
      notification_email: false,
      notification_whatsapp: true,
    });

    await cancelBooking('demo', 'b-1');

    expect(sendWaitlistPromoted).not.toHaveBeenCalled();
    expect(waWaitlistPromoted).toHaveBeenCalledTimes(1);
  });

  it('honours notification_whatsapp=false — WhatsApp suppressed, email still fires', async () => {
    setupPromotion({
      email: 'promoted@example.com',
      phone: '+2348000000000',
      full_name: 'Promoted',
      first_name: 'Promoted',
      notification_email: true,
      notification_whatsapp: false,
    });

    await cancelBooking('demo', 'b-1');

    expect(sendWaitlistPromoted).toHaveBeenCalledTimes(1);
    expect(waWaitlistPromoted).not.toHaveBeenCalled();
  });

  it('skips WhatsApp when the promoted member has no phone, regardless of opt-in', async () => {
    setupPromotion({
      email: 'promoted@example.com',
      phone: null,
      full_name: 'Promoted',
      first_name: 'Promoted',
      notification_email: true,
      notification_whatsapp: true,
    });

    await cancelBooking('demo', 'b-1');

    expect(sendWaitlistPromoted).toHaveBeenCalledTimes(1);
    expect(waWaitlistPromoted).not.toHaveBeenCalled();
  });

  it('does not crash + sends nothing when the promoted member\'s profile is missing', async () => {
    setupPromotion(null);

    const r = await cancelBooking('demo', 'b-1');

    expect(r).toEqual({ ok: true });
    expect(sendWaitlistPromoted).not.toHaveBeenCalled();
    expect(waWaitlistPromoted).not.toHaveBeenCalled();
  });

  it('does NOT fire any notification when cancelling a waitlisted row (no one was promoted)', async () => {
    state.userQueue.set('class_bookings', [
      { data: { id: 'b-1', status: 'waitlisted', class_schedule_id: 's-1', booking_date: '2026-05-30', gym_id: 'gym-1' }, error: null },
    ]);

    await cancelBooking('demo', 'b-1');

    expect(sendWaitlistPromoted).not.toHaveBeenCalled();
    expect(waWaitlistPromoted).not.toHaveBeenCalled();
  });
});

describe('bookClass — waitlist-joined notification', () => {
  function setupFullClass(profile: Record<string, unknown> | null, aheadCount: number) {
    state.userQueue.set('class_schedules', [
      { data: { id: 'sched-1', class_id: 'cls-1', gym_id: 'gym-1', classes: { max_capacity: 20 } }, error: null },
    ]);
    state.userQueue.set('class_bookings', [
      { data: null, error: null },                                  // no existing booking
      { data: null, error: null, count: 20 },                       // class is full (count == capacity)
      { data: { id: 'wl-b' }, error: null },                        // insert returns
    ]);
    // Admin client: notifyWaitlistJoined fetches profile + schedule + gym + a count.
    state.adminQueue.set('profiles', [{ data: profile, error: null }]);
    state.adminQueue.set('class_schedules', [
      { data: { start_time: '18:00', classes: { name: 'HIIT' } }, error: null },
    ]);
    state.adminQueue.set('gyms', [{ data: { slug: 'demo' }, error: null }]);
    state.adminQueue.set('class_bookings', [{ data: null, count: aheadCount, error: null }]);
  }

  it('fires email + WhatsApp when capacity is full and the member is opted into both', async () => {
    setupFullClass(
      {
        email: 'mary@example.com',
        phone: '+2348000000000',
        full_name: 'Mary M.',
        first_name: 'Mary',
        notification_email: true,
        notification_whatsapp: true,
      },
      3,
    );

    const r = await bookClass('demo', 'sched-1', '2026-05-30');
    expect(r).toEqual({ ok: true, bookingId: 'wl-b', waitlisted: true });
    expect(sendWaitlistJoined).toHaveBeenCalledTimes(1);
    expect(waWaitlistJoined).toHaveBeenCalledTimes(1);
    const emailCall = sendWaitlistJoined.mock.calls[0] as unknown as [string, { name: string; className: string; classDate: string; position?: number | null }];
    expect(emailCall[0]).toBe('mary@example.com');
    expect(emailCall[1]).toMatchObject({
      name: 'Mary M.',
      className: 'HIIT',
      classDate: '2026-05-30',
      position: 3,
    });
  });

  it('does NOT fire either notification when a seat was open (status="booked", not "waitlisted")', async () => {
    state.userQueue.set('class_schedules', [
      { data: { id: 'sched-1', class_id: 'cls-1', gym_id: 'gym-1', classes: { max_capacity: 20 } }, error: null },
    ]);
    state.userQueue.set('class_bookings', [
      { data: null, error: null },
      { data: null, error: null, count: 5 },
      { data: { id: 'fresh-b' }, error: null },
    ]);

    await bookClass('demo', 'sched-1', '2026-05-30');

    expect(sendWaitlistJoined).not.toHaveBeenCalled();
    expect(waWaitlistJoined).not.toHaveBeenCalled();
  });

  it('honours notification_email=false on the waitlist-joined path', async () => {
    setupFullClass(
      {
        email: 'mary@example.com',
        phone: '+2348000000000',
        full_name: 'Mary',
        first_name: 'Mary',
        notification_email: false,
        notification_whatsapp: true,
      },
      1,
    );

    await bookClass('demo', 'sched-1', '2026-05-30');

    expect(sendWaitlistJoined).not.toHaveBeenCalled();
    expect(waWaitlistJoined).toHaveBeenCalledTimes(1);
  });

  it('also fires when re-activating a previously cancelled booking that lands on the waitlist', async () => {
    // Same as the existing "re-activate cancelled" test, but capacity is full
    // so the re-activated booking goes to status='waitlisted' instead of 'booked'.
    state.userQueue.set('class_schedules', [
      { data: { id: 'sched-1', class_id: 'cls-1', gym_id: 'gym-1', classes: { max_capacity: 20 } }, error: null },
    ]);
    state.userQueue.set('class_bookings', [
      { data: { id: 'old-cancelled', status: 'cancelled' }, error: null }, // existing cancelled row
      { data: null, error: null, count: 20 },                              // capacity hit
    ]);
    state.adminQueue.set('profiles', [{
      data: {
        email: 'mary@example.com',
        phone: '+2348000000000',
        full_name: 'Mary',
        first_name: 'Mary',
        notification_email: true,
        notification_whatsapp: true,
      },
      error: null,
    }]);
    state.adminQueue.set('class_schedules', [
      { data: { start_time: '18:00', classes: { name: 'HIIT' } }, error: null },
    ]);
    state.adminQueue.set('gyms', [{ data: { slug: 'demo' }, error: null }]);
    state.adminQueue.set('class_bookings', [{ data: null, count: 2, error: null }]);

    const r = await bookClass('demo', 'sched-1', '2026-05-30');
    expect(r).toEqual({ ok: true, bookingId: 'old-cancelled', waitlisted: true });
    expect(sendWaitlistJoined).toHaveBeenCalledTimes(1);
  });
});
