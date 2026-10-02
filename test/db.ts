import { Pool, types, type PoolClient } from 'pg';
import { createHash } from 'node:crypto';

// DATE has no timezone. pg's default local-midnight parser can move its ISO
// day backwards on developer machines/worker runtimes east of UTC. Keep date
// fixtures calendar-stable; timestamptz retains pg's normal instant parser.
types.setTypeParser(1082, (value: string) => new Date(`${value}T00:00:00Z`));

// Shared connection pool for the test database. TEST_DATABASE_URL is set by
// `npm run test:setup` (creates the DB and applies migrations) and passed
// through vitest.
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL not set — run `npm run test:setup` first, or start via `npm test`.');

export const pool = new Pool({ connectionString: url, max: 4 });

export function fixtureSessionId(uid: string, salt = 'default'): string {
  const raw = createHash('sha256').update(`gymflow-test-session:${uid}:${salt}`).digest('hex').slice(0, 32).split('');
  raw[12] = '4';
  raw[16] = '8';
  const hex = raw.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

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
  ctx: {
    role: 'anon' | 'authenticated' | 'service_role';
    uid?: string;
    sessionId?: string;
    /** Historical fixtures exercise legitimate staff paths, so proof defaults
     * true. Security tests pass false to model a password-only JWT. */
    verified?: boolean;
    authSessionExpired?: boolean;
    accountBanned?: boolean;
    commit?: boolean;
  },
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Apply auth context BEFORE the SET ROLE — set_config('local'=true) is
    // scoped to the current transaction and stays intact for the whole fn.
    if (ctx.uid) {
      const sessionId = ctx.sessionId ?? fixtureSessionId(ctx.uid);
      if (ctx.role === 'authenticated') {
        if (ctx.accountBanned) {
          await client.query(`update auth.users set banned_until=now()+interval '1 day' where id=$1`, [ctx.uid]);
        }
        await client.query(
          `insert into auth.sessions (id, user_id, not_after)
           values ($1, $2, case when $3::boolean then now() - interval '1 minute' else now() + interval '1 day' end)
           on conflict (id) do update set user_id = excluded.user_id, not_after = excluded.not_after`,
          [sessionId, ctx.uid, ctx.authSessionExpired === true],
        );
        if (ctx.verified !== false) {
          await client.query(
            `insert into private.privileged_session_verifications
               (session_id, user_id, expires_at, method)
             values ($1, $2, now() + interval '18 hours', 'email_code')
             on conflict (session_id) do update
               set user_id = excluded.user_id, expires_at = excluded.expires_at,
                   verified_at = now(), method = 'email_code', trusted_device_id = null`,
            [sessionId, ctx.uid],
          );
        } else {
          await client.query(`delete from private.privileged_session_verifications where session_id = $1`, [sessionId]);
        }
      }
      await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [ctx.uid]);
      await client.query(
        `select set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ sub: ctx.uid, role: ctx.role, session_id: sessionId })],
      );
    }
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
