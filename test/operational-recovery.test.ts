import { describe, expect, it } from 'vitest';
import { asSuperuser, withSession } from './db';

describe('operational recovery schema', () => {
  it('keeps queue payloads encrypted and records their verification source', async () => {
    const columns = await asSuperuser(async (c) => {
      const { rows } = await c.query(
        `select column_name from information_schema.columns
          where table_schema='public' and table_name='payment_webhook_jobs'`,
      );
      return rows.map((r) => r.column_name);
    });
    expect(columns).toContain('payload_ciphertext');
    expect(columns).toContain('verification_method');
    expect(columns).not.toContain('payload');
  });

  it('denies tenant roles all mutation and only lets a proven platform session read', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      await withSession({ role }, async (c) => {
        await expect(c.query(`insert into public.payment_webhook_jobs
          (body_hash,event_name,payload_ciphertext,verified_at,verification_method)
          values ($1,'charge.success','cipher',now(),'paystack_hmac')`, ['f'.repeat(64)]))
          .rejects.toThrow(/permission denied|row-level security/i);
      });
    }
  });

  it('service role can record a repeated incident without creating duplicate open rows', async () => {
    const key = `test-${Date.now()}`;
    // Real Supabase service JWTs carry a JSON `role` claim. Include a fixture
    // subject so the local auth.jwt() shim builds the same claims object.
    await withSession({ role: 'service_role', uid: '00000000-0000-4000-8000-000000000001', commit: true }, async (c) => {
      await c.query(`select public.record_operational_incident($1,'test','ref','timeout','{}')`, [key]);
      await c.query(`select public.record_operational_incident($1,'test','ref','timeout','{}')`, [key]);
    });
    try {
      const rows = await asSuperuser(async (c) => (await c.query(
        `select attempts from public.operational_incidents where dedupe_key=$1 and resolved_at is null`, [key],
      )).rows);
      expect(rows).toEqual([{ attempts: 2 }]);
    } finally {
      await asSuperuser((c) => c.query(`delete from public.operational_incidents where dedupe_key=$1`, [key]));
    }
  });
});
