import { Pool, type PoolClient } from 'pg';

// Shared connection pool for the test database. TEST_DATABASE_URL is set by
// `npm run test:setup` (creates the DB and applies migrations) and passed
// through vitest.
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL not set — run `npm run test:setup` first, or start via `npm test`.');

export const pool = new Pool({ connectionString: url, max: 4 });

// Run a block inside a transaction with the given Supabase-shaped auth context.
// `role` selects the Postgres role that PostgREST would set (anon /
// authenticated / service_role); `uid` sets request.jwt.claim.sub so
// auth.uid() inside policies resolves to that user. Always rolls back so
// tests never mutate seeded state.
export async function withSession<T>(
  ctx: { role: 'anon' | 'authenticated' | 'service_role'; uid?: string },
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Apply auth context BEFORE the SET ROLE — set_config('local'=true) is
    // scoped to the current transaction and stays intact for the whole fn.
    if (ctx.uid) await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [ctx.uid]);
    await client.query(`select set_config('request.jwt.claim.role', $1, true)`, [ctx.role]);
    await client.query(`SET LOCAL ROLE ${ctx.role}`);
    return await fn(client);
  } finally {
    // ROLLBACK also drops the SET LOCAL role.
    try { await client.query('ROLLBACK'); } catch { /* connection may already be broken */ }
    client.release();
  }
}

// Escape hatch for setup helpers that need to run outside a transaction (e.g.
// seeding). Uses the pool's default role (postgres superuser).
export async function asSuperuser<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { return await fn(client); } finally { client.release(); }
}
