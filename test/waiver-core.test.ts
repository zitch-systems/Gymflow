import { describe, expect, it } from 'vitest';
import { acceptWaiver, getWaiverState, requireWaiverAcceptance, WaiverChangedError, WaiverRequiredError, WaiverUnavailableError } from '@/lib/waiver-core';

function fixture() {
  const state = {
    document: { id: 'waiver-a', gym_id: 'gym-a', title: 'Gym rules', content: 'Actual gym document', version: '1' } as null | Record<string, string>,
    profileSignedAt: '2026-01-01T00:00:00Z' as string | null,
    signatures: [] as Record<string, unknown>[],
    writes: 0,
    fail: false,
  };
  const client = { from(table: string) {
    const filters: Record<string, unknown> = {};
    let insert: Record<string, unknown> | undefined;
    let update: Record<string, unknown> | undefined;
    const result = () => {
      if (state.fail) return { data: null, error: { message: 'database unavailable' } };
      if (insert) { state.signatures.push(insert); state.writes++; return { data: insert, error: null }; }
      if (update) { state.profileSignedAt = String(update.waiver_signed_at); state.writes++; return { data: update, error: null }; }
      if (table === 'waivers') return { data: state.document?.gym_id === filters.gym_id ? state.document : null, error: null };
      if (table === 'profiles') return { data: { waiver_signed_at: state.profileSignedAt }, error: null };
      return { data: state.signatures.find((row) => Object.entries(filters).every(([key, value]) => row[key] === value)) ?? null, error: null };
    };
    const query = {
      select() { return query; }, eq(key: string, value: unknown) { filters[key] = value; return query; },
      order() { return query; }, limit() { return query; },
      insert(value: Record<string, unknown>) { insert = value; return query; },
      update(value: Record<string, unknown>) { update = value; return query; },
      maybeSingle: async () => result(), single: async () => result(),
      then(resolve: (value: unknown) => unknown) { return Promise.resolve(result()).then(resolve); },
    };
    return query;
  } } as unknown as Parameters<typeof getWaiverState>[0];
  return { state, client, gym: { id: 'gym-a', name: 'Gym A' } };
}

describe('explicit gym waiver acceptance', () => {
  it('shows the configured document and does not accept a global profile timestamp as its signature', async () => {
    const { client, gym } = fixture();
    const state = await getWaiverState(client, 'member', gym);
    expect(state.document.content).toBe('Actual gym document');
    expect(state.accepted).toBe(false);
    await expect(requireWaiverAcceptance(client, 'member', gym)).rejects.toBeInstanceOf(WaiverRequiredError);
  });
  it('records the exact displayed revision and is idempotent on retry', async () => {
    const { client, state, gym } = fixture();
    const displayed = await getWaiverState(client, 'member', gym);
    const expected = { gymId: gym.id, revision: displayed.document.revision };
    expect((await acceptWaiver(client, 'member', gym, expected)).accepted).toBe(true);
    await acceptWaiver(client, 'member', gym, expected);
    expect(state.writes).toBe(1);
    expect(JSON.parse(String(state.signatures[0].signature_data)).document).toEqual(displayed.document);
  });
  it('requires a new acceptance after the same document ID is edited and preserves the old snapshot', async () => {
    const { client, state, gym } = fixture();
    const first = await getWaiverState(client, 'member', gym);
    await acceptWaiver(client, 'member', gym, { gymId: gym.id, revision: first.document.revision });
    state.document!.content = 'Revised gym document';
    const revised = await getWaiverState(client, 'member', gym);
    expect(revised.accepted).toBe(false);
    await expect(acceptWaiver(client, 'member', gym, { gymId: gym.id, revision: first.document.revision })).rejects.toBeInstanceOf(WaiverChangedError);
    await acceptWaiver(client, 'member', gym, { gymId: gym.id, revision: revised.document.revision });
    expect(state.signatures).toHaveLength(2);
    expect(JSON.parse(String(state.signatures[0].signature_data)).document.content).toBe('Actual gym document');
  });
  it('refuses acceptance for another selected gym without writing anything', async () => {
    const { client, state, gym } = fixture();
    const first = await getWaiverState(client, 'member', gym);
    await expect(acceptWaiver(client, 'member', gym, { gymId: 'gym-b', revision: first.document.revision })).rejects.toBeInstanceOf(WaiverChangedError);
    expect(state.writes).toBe(0);
  });
  it('does not reuse another member signature', async () => {
    const { client, gym } = fixture();
    const first = await getWaiverState(client, 'member', gym);
    await acceptWaiver(client, 'member', gym, { gymId: gym.id, revision: first.document.revision });
    expect((await getWaiverState(client, 'other-member', gym)).accepted).toBe(false);
  });
  it('preserves the generic acknowledgement without creating a configured signature or a new native gate', async () => {
    const { client, state, gym } = fixture();
    state.document = null; state.profileSignedAt = null;
    await expect(requireWaiverAcceptance(client, 'member', gym)).resolves.toBeUndefined();
    const first = await getWaiverState(client, 'member', gym);
    expect(first.document.id).toBeNull();
    await acceptWaiver(client, 'member', gym, { gymId: gym.id, revision: first.document.revision });
    expect(state.signatures).toHaveLength(0);
    expect(state.profileSignedAt).toBeTruthy();
  });
  it('fails closed on a document query error', async () => {
    const { client, state, gym } = fixture(); state.fail = true;
    await expect(requireWaiverAcceptance(client, 'member', gym)).rejects.toBeInstanceOf(WaiverUnavailableError);
    expect(state.writes).toBe(0);
  });
});
