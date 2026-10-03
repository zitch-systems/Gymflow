import { describe, expect, it } from 'vitest';
import { getContacts, getGymOwnerEmails } from '../lib/email/recipients';

function query(result: { data: unknown; error: { message: string } | null }) {
  const chain = new Proxy<Record<string, unknown>>({}, {
    get(_target, property) {
      if (property === 'then') {
        return (resolve: (value: unknown) => void) => resolve(result);
      }
      return () => chain;
    },
  });
  return chain;
}

function adminWith(results: Array<{ data: unknown; error: { message: string } | null }>) {
  return { from: () => query(results.shift() ?? { data: [], error: null }) } as never;
}

describe('email recipient lookup errors', () => {
  it('keeps contact lookup soft by default and throws in strict mode', async () => {
    const failure = { data: null, error: { message: 'profiles unavailable' } };
    await expect(getContacts(adminWith([failure]), ['member-1'])).resolves.toEqual([]);
    await expect(getContacts(adminWith([failure]), ['member-1'], { throwOnError: true }))
      .rejects.toThrow('Contact lookup failed: profiles unavailable');
  });

  it('throws for an owner-link query failure in strict mode', async () => {
    await expect(getGymOwnerEmails(adminWith([
      { data: null, error: { message: 'links unavailable' } },
    ]), 'gym-1', { throwOnError: true })).rejects.toThrow('Gym owner lookup failed: links unavailable');
  });

  it('throws for an owner-profile query failure in strict mode', async () => {
    await expect(getGymOwnerEmails(adminWith([
      { data: [{ user_id: 'owner-1' }], error: null },
      { data: null, error: { message: 'profiles unavailable' } },
    ]), 'gym-1', { throwOnError: true }))
      .rejects.toThrow('Gym owner profile lookup failed: profiles unavailable');
  });
});
