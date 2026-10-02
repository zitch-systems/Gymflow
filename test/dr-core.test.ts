import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertIsolatedRestore, decryptArchive, encryptArchive, postgresEnv } from '../scripts/dr-core.mjs';

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
