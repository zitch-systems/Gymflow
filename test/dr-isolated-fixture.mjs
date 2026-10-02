import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Client } from 'pg';

const adminUrl = new URL(process.env.TEST_DATABASE_URL ?? '');
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(adminUrl.hostname)) {
  throw new Error('The DR fixture only runs against a loopback PostgreSQL server.');
}
adminUrl.pathname = '/postgres';
const runId = `${process.pid}_${randomBytes(6).toString('hex')}`;
const sourceDb = `gymflow_dr_source_${runId}`;
const targetDb = `gymflow_dr_target_${runId}`;
const sourceUrl = new URL(adminUrl); sourceUrl.pathname = `/${sourceDb}`;
const targetUrl = new URL(adminUrl); targetUrl.pathname = `/${targetDb}`;
const passphrase = 'fixture-only-long-passphrase';
const serviceKey = 'fixture-service-role-key';

function run(command, args, env = process.env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolvePromise() : reject(new Error(`${command} exited ${code}`)));
  });
}

function runExpectingFailure(command, args, env = process.env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'ignore', 'ignore'] });
    child.on('error', reject);
    child.on('exit', (code) => code && code !== 0
      ? resolvePromise()
      : reject(new Error(`${command} unexpectedly succeeded`)));
  });
}

async function sql(url, statement) {
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try { return await client.query(statement); } finally { await client.end(); }
}

async function resetDatabase(name) {
  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    await client.query(`drop database if exists ${name}`);
    await client.query(`create database ${name}`);
  } finally { await client.end(); }
}

async function dropDatabase(name) {
  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    await client.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [name]);
    await client.query(`drop database if exists ${name}`);
  } finally { await client.end(); }
}

const schema = `
  create schema auth; create schema storage;
  create table auth.users(id uuid primary key, email text not null);
  create table public.gyms(id uuid primary key, name text not null);
  create table storage.buckets(id text primary key, public boolean not null);
  create table storage.objects(id uuid primary key, bucket_id text references storage.buckets(id), name text not null);
`;

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** Minimal deterministic Supabase Storage adapter. It exercises the production
 * backup/restore HTTP requests without requiring a remote project or secrets. */
function storageAdapter() {
  const restored = new Map();
  const object = Buffer.from('synthetic storage object\n');
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://fixture.invalid');
    const authorized = req.headers.apikey === serviceKey && req.headers.authorization === `Bearer ${serviceKey}`;
    if (!authorized) { res.writeHead(401).end('unauthorized'); return; }
    if (req.method === 'GET' && url.pathname === '/storage/v1/bucket') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify([{ id: 'gym-assets' }])); return;
    }
    if (req.method === 'POST' && url.pathname === '/storage/v1/object/list/gym-assets') {
      const request = JSON.parse((await body(req)).toString('utf8'));
      const rows = request.offset === 0 ? [{ id: 'fixture-object-id', name: 'logos/fixture.txt' }] : [];
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(rows)); return;
    }
    if (req.method === 'GET' && url.pathname === '/storage/v1/object/authenticated/gym-assets/logos/fixture.txt') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(object); return;
    }
    if (req.method === 'POST' && url.pathname === '/storage/v1/object/gym-assets/logos/fixture.txt') {
      restored.set('gym-assets/logos/fixture.txt', await body(req));
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}'); return;
    }
    res.writeHead(404).end('not found');
  });
  return { server, restored, object };
}

const staging = await mkdtemp(resolve(tmpdir(), 'gymflow-dr-fixture-'));
const { server, restored, object } = storageAdapter();
let serverListening = false;
try {
  await resetDatabase(sourceDb);
  await resetDatabase(targetDb);
  await sql(sourceUrl, schema);
  await sql(targetUrl, schema);
  await sql(sourceUrl, `
    insert into auth.users values ('10000000-0000-4000-8000-000000000001','fixture@example.invalid');
    insert into public.gyms values ('20000000-0000-4000-8000-000000000001','Fixture Gym');
    insert into storage.buckets values ('gym-assets',false);
    insert into storage.objects values ('30000000-0000-4000-8000-000000000001','gym-assets','logos/fixture.txt');
  `);
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject); server.listen(0, '::', resolvePromise);
  });
  serverListening = true;
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Storage fixture did not bind a TCP port.');
  const artifact = resolve(staging, 'fixture.tgz.enc');
  const common = { ...process.env, DR_BACKUP_PASSPHRASE: passphrase };

  await run(process.execPath, ['scripts/dr-backup.mjs', '--output', artifact], {
    ...common, SUPABASE_DB_URL: sourceUrl.toString(),
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${address.port}`,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
  });
  await run(process.execPath, ['scripts/dr-restore.mjs', '--archive', artifact], common);
  const before = await sql(targetUrl, 'select count(*)::int as gyms from public.gyms');
  if (before.rows[0].gyms !== 0 || restored.size !== 0) throw new Error('Verification-only mode mutated the restore target.');

  // Restore mode must remain fail-closed without its explicit isolated-target
  // acknowledgement. Check that guard before allowing the successful run.
  const missingAck = {
    ...common, DR_RESTORE_DB_URL: targetUrl.toString(),
    DR_RESTORE_SUPABASE_URL: `http://localhost:${address.port}`,
    DR_RESTORE_SERVICE_ROLE_KEY: serviceKey,
  };
  delete missingAck.DR_RESTORE_ACK;
  await runExpectingFailure(process.execPath, ['scripts/dr-restore.mjs', '--archive', artifact, '--restore'], missingAck);
  const afterRefusal = await sql(targetUrl, 'select count(*)::int as gyms from public.gyms');
  if (afterRefusal.rows[0].gyms !== 0 || restored.size !== 0) throw new Error('Refused restore mutated the target.');

  await run(process.execPath, ['scripts/dr-restore.mjs', '--archive', artifact, '--restore'], {
    ...common, DR_RESTORE_ACK: 'ISOLATED_ONLY', DR_RESTORE_DB_URL: targetUrl.toString(),
    DR_RESTORE_SUPABASE_URL: `http://localhost:${address.port}`,
    DR_RESTORE_SERVICE_ROLE_KEY: serviceKey,
  });
  const counts = await sql(targetUrl, `select
    (select count(*) from auth.users)::int as auth_users,
    (select count(*) from public.gyms)::int as gyms,
    (select count(*) from storage.objects)::int as storage_objects`);
  const got = counts.rows[0];
  if (got.auth_users !== 1 || got.gyms !== 1 || got.storage_objects !== 1) throw new Error(`restored row counts were wrong: ${JSON.stringify(got)}`);
  if (!restored.get('gym-assets/logos/fixture.txt')?.equals(object)) throw new Error('Storage object did not round-trip through the real entrypoints.');
  const encrypted = await readFile(artifact);
  if (encrypted.includes(Buffer.from('fixture@example.invalid')) || encrypted.includes(Buffer.from('synthetic storage object'))) {
    throw new Error('Encrypted artifact exposed fixture plaintext.');
  }
  console.log('Isolated DR entrypoints passed: database=1 Auth=1 Storage metadata=1 object=1; verification made no writes.');
} finally {
  // Attempt every cleanup even if an earlier one fails. In particular, a
  // temporary-file error must never leave fixture databases behind.
  const cleanup = await Promise.allSettled([
    serverListening
      ? new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()))
      : Promise.resolve(),
    rm(staging, { recursive: true, force: true }),
    dropDatabase(sourceDb),
    dropDatabase(targetDb),
  ]);
  const failed = cleanup.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}
