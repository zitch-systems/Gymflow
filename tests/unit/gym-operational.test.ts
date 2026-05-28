import { describe, it, expect, vi } from 'vitest';

// gymIsOperational is pure, but the surrounding module imports `next/navigation`
// (for redirect) and Supabase. Stub them so the import succeeds under Node.
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ getSessionUser: vi.fn() }));

import { gymIsOperational } from '@/lib/auth/gym';
import type { Database } from '@/lib/database.types';

type Gym = Database['public']['Tables']['gyms']['Row'];

function gym(overrides: Partial<Gym>): Gym {
  return {
    id: 'g',
    slug: 's',
    name: 'n',
    status: 'active',
    subscription_status: 'active',
    ...overrides,
  } as Gym;
}

describe('gymIsOperational — suspension policy', () => {
  it('lets an active+active gym through', () => {
    expect(gymIsOperational(gym({}))).toBe(true);
  });

  it('lets a past_due gym through (renewals cron still retrying)', () => {
    expect(gymIsOperational(gym({ subscription_status: 'past_due' }))).toBe(true);
  });

  it('lets a trial gym through', () => {
    expect(gymIsOperational(gym({ subscription_status: 'trial' }))).toBe(true);
  });

  it('blocks a suspended gym (admin action)', () => {
    expect(gymIsOperational(gym({ status: 'suspended' }))).toBe(false);
  });

  it('blocks an inactive gym (terminated)', () => {
    expect(gymIsOperational(gym({ status: 'inactive' }))).toBe(false);
  });

  it('blocks a cancelled-subscription gym even if status is somehow still active', () => {
    expect(gymIsOperational(gym({ status: 'active', subscription_status: 'cancelled' }))).toBe(false);
  });
});
