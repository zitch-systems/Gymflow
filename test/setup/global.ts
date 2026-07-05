import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';

// Vitest global setup: builds a fresh test database from scratch by applying
// the in-repo migrations (baseline + incrementals) to a plain Postgres, then
// exports TEST_DATABASE_URL so test files can connect.
//
// The database URL is resolved in this order:
//   1. TEST_DATABASE_URL (already set — CI and advanced local use)
//   2. build one from POSTGRES_HOST / POSTGRES_PORT / POSTGRES_USER /
//      POSTGRES_PASSWORD (CI service pattern)
//   3. postgres://postgres:postgres@127.0.0.1:5432/postgres (Homebrew default)
//
// The DB name is always `gymflow_test`; anything already in it is dropped.

const REPO_ROOT = resolve(__dirname, '..', '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'supabase', 'migrations');
const PREREQS_PATH = join(REPO_ROOT, 'test', 'setup', 'prereqs.sql');
const TEST_DB = 'gymflow_test';

function baseUrl(): string {
  if (process.env.TEST_DATABASE_URL) {
    const u = new URL(process.env.TEST_DATABASE_URL);
    u.pathname = '/postgres';
    return u.toString();
  }
  const host = process.env.POSTGRES_HOST ?? '127.0.0.1';
  const port = process.env.POSTGRES_PORT ?? '5432';
  const user = process.env.POSTGRES_USER ?? 'postgres';
  const password = process.env.POSTGRES_PASSWORD ?? 'postgres';
  return `postgres://${user}:${encodeURIComponent(password)}@${host}:${port}/postgres`;
}

function testUrl(): string {
  const u = new URL(baseUrl());
  u.pathname = `/${TEST_DB}`;
  return u.toString();
}

async function connect(url: string): Promise<Client> {
  const c = new Client({ connectionString: url });
  await c.connect();
  return c;
}

async function rebuildDatabase() {
  const admin = await connect(baseUrl());
  try {
    // Force-disconnect anyone still holding the old DB (previous crashed run,
    // vitest UI, etc.) — otherwise DROP DATABASE hangs.
    await admin.query(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
      [TEST_DB],
    );
    await admin.query(`drop database if exists ${TEST_DB}`);
    await admin.query(`create database ${TEST_DB}`);
  } finally { await admin.end(); }
}

async function apply(client: Client, sql: string, label: string) {
  try { await client.query(sql); }
  catch (e) { throw new Error(`Failed applying ${label}: ${(e as Error).message}`); }
}

export default async function setup() {
  await rebuildDatabase();
  const url = testUrl();
  const db = await connect(url);
  try {
    await apply(db, readFileSync(PREREQS_PATH, 'utf8'), 'prereqs.sql');
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
      await apply(db, sql, f);
    }
  } finally { await db.end(); }
  process.env.TEST_DATABASE_URL = url;
}
