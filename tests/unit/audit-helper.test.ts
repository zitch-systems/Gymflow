import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture admin client construction + insert payload.
const { state, adminMock } = vi.hoisted(() => {
  const state: {
    inserts: Array<{ table: string; payload: unknown }>;
    throwOnInsert: boolean;
  } = { inserts: [], throwOnInsert: false };
  const adminMock = {
    from(table: string) {
      return {
        insert(payload: unknown) {
          if (state.throwOnInsert) throw new Error('service-role unavailable');
          state.inserts.push({ table, payload });
          return { error: null };
        },
      };
    },
  };
  return { state, adminMock };
});

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminMock }));

import { audit } from '@/lib/audit';

beforeEach(() => {
  state.inserts = [];
  state.throwOnInsert = false;
});

describe('audit helper', () => {
  it('writes to audit_logs via the service-role admin client (RLS-bypass by design)', async () => {
    await audit({
      gymId: 'gym-1',
      actorId: 'actor-1',
      action: 'admin.thing_did',
      table: 'things',
      recordId: 'thing-1',
      before: { name: 'old' },
      after: { name: 'new' },
    });
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0].table).toBe('audit_logs');
    expect(state.inserts[0].payload).toMatchObject({
      gym_id: 'gym-1',
      actor_id: 'actor-1',
      action: 'admin.thing_did',
      table_name: 'things',
      record_id: 'thing-1',
      old_values: { name: 'old' },
      new_values: { name: 'new' },
    });
  });

  it('never throws when the insert fails — audit must not block the op it tracks', async () => {
    state.throwOnInsert = true;
    await expect(
      audit({
        gymId: 'gym-1',
        actorId: null,
        action: 'admin.thing_did',
        table: 'things',
      }),
    ).resolves.toBeUndefined();
  });

  it('passes null for optional fields when omitted', async () => {
    await audit({
      gymId: null,
      actorId: null,
      action: 'system.cron_ran',
      table: 'memberships',
    });
    expect(state.inserts[0].payload).toMatchObject({
      gym_id: null,
      actor_id: null,
      record_id: null,
      old_values: null,
      new_values: null,
    });
  });
});
