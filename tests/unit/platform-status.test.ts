import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the `.update(...)` payload to assert correct column mapping.
const { capturedUpdate, adminMock } = vi.hoisted(() => {
  const capturedUpdate: { value: Record<string, unknown> | null } = { value: null };
  const adminMock = {
    from(_table: string) {
      void _table;
      return {
        update(payload: Record<string, unknown>) {
          capturedUpdate.value = payload;
          return { eq: () => ({ error: null }) };
        },
        insert: () => ({ error: null }),
      };
    },
  };
  return { capturedUpdate, adminMock };
});

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminMock }));
vi.mock('@/lib/auth/dal', () => ({
  getProfile: vi.fn(async () => ({ id: 'admin-1', role: 'platform_admin' })),
  isPlatformAdmin: vi.fn(async () => true),
  getSessionUser: vi.fn(async () => ({ id: 'admin-1' })),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

import { platformSetGymStatus } from '@/lib/actions/platform';

beforeEach(() => { capturedUpdate.value = null; });

describe('platformSetGymStatus — constraint-safe column mapping', () => {
  it("maps 'active' to status='active' AND subscription_status='active'", async () => {
    await platformSetGymStatus('gym-1', 'active');
    expect(capturedUpdate.value).toMatchObject({ status: 'active', subscription_status: 'active' });
  });

  it("maps 'suspended' to a constraint-valid subscription_status ('past_due'), not literally 'suspended'", async () => {
    // gyms.subscription_status only allows trial|active|past_due|cancelled —
    // the original code wrote 'suspended' to both columns and the DB rejected it.
    await platformSetGymStatus('gym-1', 'suspended');
    expect(capturedUpdate.value?.status).toBe('suspended');
    expect(capturedUpdate.value?.subscription_status).toBe('past_due');
  });

  it("maps 'terminated' to status='inactive' + subscription_status='cancelled'", async () => {
    await platformSetGymStatus('gym-1', 'terminated');
    expect(capturedUpdate.value?.status).toBe('inactive');
    expect(capturedUpdate.value?.subscription_status).toBe('cancelled');
  });
});
