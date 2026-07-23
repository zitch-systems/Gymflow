import { describe, expect, it } from 'vitest';
import { asSuperuser, withSession } from './db';

// Contract tests for public.webhook_events (20260722_webhook_events.sql), the
// webhook replay ledger: a processed body's hash is recorded once; a second
// insert of the same hash (a byte-identical replay) must violate the PK; and
// the table is service-role-only like rate_limits.

const HASH = 'a'.repeat(64);

describe('webhook_events replay ledger', () => {
  it('records a processed body once, rejects the same hash again', async () => {
    await withSession({ role: 'service_role' }, async (c) => {
      await c.query(
        `insert into public.webhook_events (body_hash, event_name) values ($1, $2)`,
        [HASH, 'subscription.disable'],
      );
      // Byte-identical replay → same hash → unique violation (23505), which
      // the route treats as "already processed, ack and do nothing".
      await expect(
        c.query(`insert into public.webhook_events (body_hash, event_name) values ($1, $2)`, [HASH, 'subscription.disable']),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });

  it('a processed hash is visible to the service role for the pre-check', async () => {
    await withSession({ role: 'service_role', commit: true }, async (c) => {
      await c.query(`insert into public.webhook_events (body_hash, event_name) values ($1, 'charge.success')`, [HASH]);
    });
    try {
      const found = await withSession({ role: 'service_role' }, async (c) => {
        const { rows } = await c.query(`select event_name from public.webhook_events where body_hash = $1`, [HASH]);
        return rows;
      });
      expect(found).toHaveLength(1);
      expect(found[0].event_name).toBe('charge.success');
    } finally {
      await asSuperuser((c) => c.query(`delete from public.webhook_events where body_hash = $1`, [HASH]));
    }
  });

  it('anon and authenticated can neither read nor write the ledger', async () => {
    // One statement per session — a failed statement poisons the rest of its
    // transaction, so each denial gets a fresh one.
    for (const role of ['anon', 'authenticated'] as const) {
      await withSession({ role }, async (c) => {
        await expect(c.query(`select * from public.webhook_events`)).rejects.toThrow(/permission denied/i);
      });
      await withSession({ role }, async (c) => {
        await expect(
          c.query(`insert into public.webhook_events (body_hash) values ('${'b'.repeat(64)}')`),
        ).rejects.toThrow(/permission denied/i);
      });
      await withSession({ role }, async (c) => {
        await expect(c.query(`delete from public.webhook_events`)).rejects.toThrow(/permission denied/i);
      });
    }
  });
});
