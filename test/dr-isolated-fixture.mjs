import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { Client } from 'pg';
import { decryptArchive, encryptArchive, postgresEnv } from '../scripts/dr-core.mjs';

const adminUrl = new URL(process.env.TEST_DATABASE_URL ?? '');
adminUrl.pathname = '/postgres';
const sourceUrl = new URL(adminUrl); sourceUrl.pathname = '/gymflow_dr_source';
const targetUrl = new URL(adminUrl); targetUrl.pathname = '/gymflow_dr_target';

function run(command, args, env = process.env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolvePromise() : reject(new Error(`${command} exited ${code}`)));
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

const schema = `
  create schema auth; create schema storage;
  create table auth.users(id uuid primary key, email text not null);
  create table public.gyms(id uuid primary key, name text not null);
  create table storage.buckets(id text primary key, public boolean not null);
  create table storage.objects(id uuid primary key, bucket_id text references storage.buckets(id), name text not null);
`;

const staging = await mkdtemp(resolve(tmpdir(), 'gymflow-dr-fixture-'));
try {
  await resetDatabase('gymflow_dr_source');
  await resetDatabase('gymflow_dr_target');
  await sql(sourceUrl, schema);
  await sql(targetUrl, schema);
  await sql(sourceUrl, `
    insert into auth.users values ('10000000-0000-4000-8000-000000000001','fixture@example.invalid');
    insert into public.gyms values ('20000000-0000-4000-8000-000000000001','Fixture Gym');
    insert into storage.buckets values ('gym-assets',false);
    insert into storage.objects values ('30000000-0000-4000-8000-000000000001','gym-assets','logos/fixture.txt');
  `);

  const dump = resolve(staging, 'database.dump');
  await run('pg_dump', ['--format=custom', '--data-only', '--no-owner', '--no-acl', '--schema=public', '--schema=auth', '--schema=storage', '--file', dump], postgresEnv(sourceUrl.toString()));
  const objectFile = resolve(staging, 'storage/gym-assets/fixture-object');
  await mkdir(dirname(objectFile), { recursive: true });
  await writeFile(objectFile, 'synthetic storage object\n');
  const manifest = {
    format: { version: 1 }, generated_at: new Date().toISOString(),
    source: { host: 'fixture-source.local' },
    database: { file: 'database.dump', schemas: ['public', 'auth', 'storage'] },
    storage: { objects: [{ bucket: 'gym-assets', path: 'logos/fixture.txt', file: 'storage/gym-assets/fixture-object' }] },
    config: { public: { site_url: 'https://fixture.invalid' }, secret_presence: { PAYSTACK_SECRET_KEY: true } },
  };
  await writeFile(resolve(staging, 'manifest.json'), JSON.stringify(manifest));
  const tar = resolve(staging, 'fixture.tgz');
  await run('tar', ['-czf', tar, '-C', staging, 'database.dump', 'manifest.json', 'storage']);
  const artifact = resolve(staging, 'fixture.tgz.enc');
  await encryptArchive(tar, artifact, 'fixture-only-long-passphrase');

  const restoredTar = resolve(staging, 'restored.tgz');
  const restoredDir = resolve(staging, 'restored');
  await mkdir(restoredDir);
  await decryptArchive(artifact, restoredTar, 'fixture-only-long-passphrase');
  await run('tar', ['-xzf', restoredTar, '-C', restoredDir]);
  const targetEnv = postgresEnv(targetUrl.toString());
  await run('pg_restore', ['--dbname', targetEnv.PGDATABASE, '--data-only', '--disable-triggers', '--single-transaction', '--exit-on-error', '--no-owner', '--no-acl', resolve(restoredDir, 'database.dump')], targetEnv);

  const counts = await sql(targetUrl, `select
    (select count(*) from auth.users)::int as auth_users,
    (select count(*) from public.gyms)::int as gyms,
    (select count(*) from storage.objects)::int as storage_objects`);
  const got = counts.rows[0];
  if (got.auth_users !== 1 || got.gyms !== 1 || got.storage_objects !== 1) throw new Error(`restored row counts were wrong: ${JSON.stringify(got)}`);
  if ((await readFile(resolve(restoredDir, 'storage/gym-assets/fixture-object'), 'utf8')) !== 'synthetic storage object\n') throw new Error('storage object did not round-trip');
  const restoredManifest = JSON.parse(await readFile(resolve(restoredDir, 'manifest.json'), 'utf8'));
  if (JSON.stringify(restoredManifest).includes('sk_')) throw new Error('configuration manifest leaked a secret value');
  console.log('Synthetic isolated DR fixture passed: DB=1 Auth=1 Storage metadata=1 object=1 config=secret-presence-only.');
} finally {
  await rm(staging, { recursive: true, force: true });
}
