#!/usr/bin/env node
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { assertIsolatedRestore, decryptArchive, postgresEnv } from './dr-core.mjs';

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'], ...options });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolvePromise() : reject(new Error(`${command} exited ${code}`)));
  });
}

async function restoreStorage(manifest, staging, targetUrl, serviceKey) {
  const headers = { authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'x-upsert': 'true' };
  let restored = 0;
  for (const object of manifest.storage?.objects ?? []) {
    const file = resolve(staging, object.file);
    if (!file.startsWith(resolve(staging, 'storage') + '/')) throw new Error('Manifest contains an unsafe Storage path.');
    const url = `${targetUrl}/storage/v1/object/${encodeURIComponent(object.bucket)}/${object.path.split('/').map(encodeURIComponent).join('/')}`;
    const response = await fetch(url, { method: 'POST', headers, body: createReadStream(file), duplex: 'half' });
    if (!response.ok) throw new Error(`Storage restore failed for ${object.bucket}/${object.path} (${response.status}).`);
    restored++;
  }
  return restored;
}

export async function main() {
  const archiveIndex = process.argv.indexOf('--archive');
  if (archiveIndex < 0 || !process.argv[archiveIndex + 1]) throw new Error('Usage: node scripts/dr-restore.mjs --archive <file> [--restore]');
  const archive = resolve(process.argv[archiveIndex + 1]);
  const mutate = process.argv.includes('--restore');
  const passphrase = process.env.DR_BACKUP_PASSPHRASE;
  if (!passphrase) throw new Error('DR_BACKUP_PASSPHRASE is required.');

  const staging = await mkdtemp(resolve(tmpdir(), 'gymflow-restore-'));
  try {
    const tarPath = resolve(staging, 'archive.tgz');
    await decryptArchive(archive, tarPath, passphrase);
    await run('tar', ['-xzf', tarPath, '-C', staging, '--no-same-owner', '--no-same-permissions']);
    const manifest = JSON.parse(await readFile(resolve(staging, 'manifest.json'), 'utf8'));
    if (manifest?.format?.version !== 1 || manifest?.database?.file !== 'database.dump') throw new Error('Backup manifest is not a supported GymFlow DR artifact.');
    await stat(resolve(staging, 'database.dump'));

    console.log(`Artifact verified: ${manifest.generated_at}; source ${manifest.source?.host ?? 'unknown'}.`);
    console.log(`Contains database/Auth data and ${manifest.storage?.objects?.length ?? 0} Storage object(s).`);
    if (!mutate) {
      console.log('Verification only. Pass --restore with isolated target variables to load it.');
      return;
    }

    const targetDb = process.env.DR_RESTORE_DB_URL;
    const targetUrl = process.env.DR_RESTORE_SUPABASE_URL?.replace(/\/$/, '');
    const targetKey = process.env.DR_RESTORE_SERVICE_ROLE_KEY;
    if (!targetDb || !targetUrl || !targetKey) throw new Error('DR_RESTORE_DB_URL, DR_RESTORE_SUPABASE_URL, and DR_RESTORE_SERVICE_ROLE_KEY are required.');
    const targetHost = new URL(targetUrl).hostname;
    assertIsolatedRestore({ ack: process.env.DR_RESTORE_ACK, sourceHost: manifest.source?.host, targetHost });
    if (new URL(targetDb).hostname !== targetHost && !targetHost.startsWith('localhost')) {
      // Supabase DB and API hosts use different prefixes, but must carry the
      // same project ref. Avoid accepting an unrelated target by accident.
      const ref = targetHost.split('.')[0];
      if (!new URL(targetDb).hostname.includes(ref)) throw new Error('Database and API targets do not belong to the same isolated project.');
    }

    // Schema migrations must already be at the artifact's code version. This
    // restores rows only and fails on any collision rather than overwriting a
    // live tenant with older data.
    const postgres = postgresEnv(targetDb);
    await run('pg_restore', ['--dbname', postgres.PGDATABASE, '--data-only', '--disable-triggers', '--single-transaction', '--exit-on-error', '--no-owner', '--no-acl', resolve(staging, 'database.dump')], {
      env: postgres,
    });
    const objects = await restoreStorage(manifest, staging, targetUrl, targetKey);
    console.log(`Isolated restore completed: database/Auth plus ${objects} Storage object(s).`);
    console.log('Project Auth URLs/hooks, provider webhooks, and secret values must now be applied from the credential manager and checked against manifest.config.');
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
