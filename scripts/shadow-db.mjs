// Build a shadow database from the checked-in migrations (prereqs + baseline +
// incrementals), mirroring test/setup/global.ts. Used by the CI schema-drift
// job: the shadow is "what the repo says the schema is", which is then
// fingerprinted and diffed against the live Supabase database.
//
// Usage: node scripts/shadow-db.mjs
//   Env: POSTGRES_HOST/PORT/USER/PASSWORD (defaults match the CI service),
//        SHADOW_DB (default gymflow_shadow).
//   Prints the shadow DB connection string on stdout (last line).

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const PREREQS = join(ROOT, 'test', 'setup', 'prereqs.sql');
const DB = process.env.SHADOW_DB ?? 'gymflow_shadow';

const host = process.env.POSTGRES_HOST ?? '127.0.0.1';
const port = process.env.POSTGRES_PORT ?? '5432';
const user = process.env.POSTGRES_USER ?? 'postgres';
const password = process.env.POSTGRES_PASSWORD ?? 'postgres';
const base = `postgres://${user}:${encodeURIComponent(password)}@${host}:${port}`;

const admin = new pg.Client({ connectionString: `${base}/postgres` });
await admin.connect();
await admin.query(`drop database if exists ${DB}`);
await admin.query(`create database ${DB}`);
await admin.end();

const shadow = new pg.Client({ connectionString: `${base}/${DB}` });
await shadow.connect();
await shadow.query(readFileSync(PREREQS, 'utf8'));
for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
  try {
    await shadow.query(readFileSync(join(MIGRATIONS, f), 'utf8'));
  } catch (e) {
    console.error(`migration failed: ${f}: ${e.message}`);
    process.exit(1);
  }
}
await shadow.end();
console.log(`${base}/${DB}`);
