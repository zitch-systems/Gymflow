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
// auth.uid() inside policies resolves to that user.
//
// Default: rolls back so tests never mutate seeded state (right for isolation
// tests that just probe RLS). Pass `commit: true` when the test needs the
// write to survive so a follow-up assertion or query can observe it (right for
// state-machine tests like freeze). Either way the caller's role is restored
// to the connection default before the client returns to the pool.
export async function withSession<T>(
  ctx: { role: 'anon' | 'authenticated' | 'service_role'; uid?: string; commit?: boolean },
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
    const out = await fn(client);
    if (ctx.commit) await client.query('COMMIT');
    else await client.query('ROLLBACK');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* connection may already be broken */ }
    throw e;
  } finally {
    client.release();
  }
}

// Escape hatch for setup helpers that need to run outside a transaction (e.g.
// seeding). Uses the pool's default role (postgres superuser).
export async function asSuperuser<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { return await fn(client); } finally { client.release(); }
}
