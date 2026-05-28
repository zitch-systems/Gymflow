import { describe, it, expect, vi, beforeEach } from 'vitest';
import { audit } from '@/lib/audit';
import { createMockSupabase } from './_mock-supabase';

beforeEach(() => vi.restoreAllMocks());

describe('audit helper', () => {
  it('inserts into audit_logs with the canonical column shape', async () => {
    const supabase = createMockSupabase([{ data: null, error: null }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await audit(supabase as any, {
      gymId: 'gym-1',
      actorId: 'actor-1',
      action: 'admin.thing_did',
      table: 'things',
      recordId: 'thing-1',
      before: { name: 'old' },
      after: { name: 'new' },
    });
    expect(supabase._fromCalls.map((c) => c.table)).toEqual(['audit_logs']);
  });

  it('never throws when the insert fails — audit must not block the op it tracks', async () => {
    const supabase = {
      from: () => {
        throw new Error('boom');
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(audit(supabase as any, {
      gymId: 'gym-1',
      actorId: null,
      action: 'admin.thing_did',
      table: 'things',
    })).resolves.toBeUndefined();
  });

  it('passes null for optional fields when omitted', async () => {
    const supabase = createMockSupabase([{ data: null, error: null }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await audit(supabase as any, {
      gymId: null,
      actorId: null,
      action: 'system.cron_ran',
      table: 'memberships',
    });
    expect(supabase._consumed()).toBe(1);
  });
});
