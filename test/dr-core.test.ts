import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertIsolatedRestore, assertRestoreTargetBinding, decryptArchive, encryptArchive, postgresEnv } from '../scripts/dr-core.mjs';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

describe('DR artifact encryption', () => {
  it('round-trips and rejects a wrong passphrase', async () => {
    const dir = await mkdtemp(resolve(tmpdir(), 'gymflow-dr-test-'));
    dirs.push(dir);
    const source = resolve(dir, 'source');
    const artifact = resolve(dir, 'artifact.enc');
    const restored = resolve(dir, 'restored');
    await writeFile(source, 'database, auth, and storage bytes');
    await encryptArchive(source, artifact, 'a-long-test-passphrase-with-entropy');
    expect(await readFile(artifact, 'utf8')).not.toContain('database, auth');
    await decryptArchive(artifact, restored, 'a-long-test-passphrase-with-entropy');
    expect(await readFile(restored, 'utf8')).toBe('database, auth, and storage bytes');
    await expect(decryptArchive(artifact, `${restored}-wrong`, 'a-different-long-test-passphrase')).rejects.toThrow();
  });
});

describe('isolated restore gate', () => {
  it('requires the exact acknowledgement and refuses the source project', () => {
    expect(() => assertIsolatedRestore({ ack: undefined, sourceHost: 'source.supabase.co', targetHost: 'target.supabase.co' })).toThrow(/ACK|ack|Set/);
    expect(() => assertIsolatedRestore({ ack: 'ISOLATED_ONLY', sourceHost: 'same.supabase.co', targetHost: 'same.supabase.co' })).toThrow(/source project/);
  });

  it('accepts a different Supabase target only after acknowledgement', () => {
    expect(() => assertIsolatedRestore({ ack: 'ISOLATED_ONLY', sourceHost: 'source.supabase.co', targetHost: 'target.supabase.co' })).not.toThrow();
  });

  it.each(['evillocalhost', 'evil127.0.0.1', 'target.supabase.co.evil.test', 'evil-target.supabase.co.example'])('rejects deceptive target host %s', (targetHost) => {
    expect(() => assertIsolatedRestore({ ack: 'ISOLATED_ONLY', sourceHost: 'source.supabase.co', targetHost })).toThrow(/recognisable/);
  });

  it('binds exact direct and pooler database identities to the API project', () => {
    expect(() => assertRestoreTargetBinding('https://targetref.supabase.co', 'postgresql://postgres:x@db.targetref.supabase.co/postgres')).not.toThrow();
    expect(() => assertRestoreTargetBinding('https://targetref.supabase.co', 'postgresql://postgres.targetref:x@aws-0-eu-west-1.pooler.supabase.com/postgres')).not.toThrow();
    expect(() => assertRestoreTargetBinding('http://localhost:54321', 'postgresql://postgres:x@127.0.0.1:5432/postgres')).not.toThrow();
  });

  it('requires HTTPS for a remote API while preserving local HTTP drills', () => {
    expect(() => assertRestoreTargetBinding('http://targetref.supabase.co', 'postgresql://postgres:x@db.targetref.supabase.co/postgres')).toThrow(/HTTPS/);
    expect(() => assertRestoreTargetBinding('http://127.0.0.1:54321', 'postgresql://postgres:x@localhost:5432/postgres')).not.toThrow();
  });

  it.each([
    'ftp://targetref.supabase.co',
    'https://user:secret@targetref.supabase.co',
    'https://targetref.supabase.co/storage/v1',
    'https://targetref.supabase.co?apikey=secret',
    'https://targetref.supabase.co#secret',
  ])('rejects a non-canonical API origin: %s', (apiUrl) => {
    expect(() => assertRestoreTargetBinding(apiUrl, 'postgresql://postgres:x@db.targetref.supabase.co/postgres')).toThrow(/API URL|project origin/);
  });

  it.each([
    'https://postgres:x@db.targetref.supabase.co/postgres',
    'ftp://postgres:x@db.targetref.supabase.co/postgres',
    'postgresql://postgres:x@db.targetref.supabase.co',
  ])('rejects a non-Postgres database URL or missing database name: %s', (databaseUrl) => {
    expect(() => assertRestoreTargetBinding('https://targetref.supabase.co', databaseUrl)).toThrow(/Database URL/);
  });

  it.each([
    'postgresql://postgres:x@db.evil-targetref.supabase.co/postgres',
    'postgresql://postgres:x@db.targetref.supabase.co.evil.test/postgres',
    'postgresql://postgres.evil-targetref:x@aws-0-eu-west-1.pooler.supabase.com/postgres',
    'postgresql://postgres.targetref:x@evilpooler.supabase.com.example/postgres',
  ])('rejects a database target that only contains the API ref: %s', (databaseUrl) => {
    expect(() => assertRestoreTargetBinding('https://targetref.supabase.co', databaseUrl)).toThrow(/same isolated project/);
  });
});

describe('Postgres subprocess environment', () => {
  it('keeps decoded credentials out of argv-compatible connection strings', () => {
    const env = postgresEnv('postgresql://gym%40flow:p%40ss@db.example:6543/app%20db?sslmode=require');
    expect(env).toMatchObject({
      PGHOST: 'db.example', PGPORT: '6543', PGUSER: 'gym@flow',
      PGPASSWORD: 'p@ss', PGDATABASE: 'app db', PGSSLMODE: 'require',
    });
  });
});
