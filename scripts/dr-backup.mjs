#!/usr/bin/env node
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { DR_FORMAT, assertRestoreTargetBinding, encryptArchive, postgresEnv } from './dr-core.mjs';

const REQUIRED_SECRETS = [
  'SUPABASE_SERVICE_ROLE_KEY', 'PAYSTACK_SECRET_KEY', 'CRON_SECRET',
  'SECRETS_ENCRYPTION_KEY', 'RESEND_API_KEY', 'SUPABASE_AUTH_HOOK_SECRET',
  'RESEND_WEBHOOK_SECRET', 'META_APP_SECRET', 'WHATSAPP_ACCESS_TOKEN',
];

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'], ...options });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolvePromise() : reject(new Error(`${command} exited ${code}`)));
  });
}

async function storageObjects(baseUrl, key, staging) {
  const headers = { authorization: `Bearer ${key}`, apikey: key, 'content-type': 'application/json' };
  const bucketsRes = await fetch(`${baseUrl}/storage/v1/bucket`, { headers });
  if (!bucketsRes.ok) throw new Error(`Storage bucket list failed (${bucketsRes.status}).`);
  const buckets = await bucketsRes.json();
  const objects = [];
  for (const bucket of buckets) {
    if (!bucket?.id) continue;
    const prefixes = [''];
    while (prefixes.length) {
      const prefix = prefixes.shift();
      let offset = 0;
      for (;;) {
        const listed = await fetch(`${baseUrl}/storage/v1/object/list/${encodeURIComponent(bucket.id)}`, {
          method: 'POST', headers,
          body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: 'name', order: 'asc' } }),
        });
        if (!listed.ok) throw new Error(`Storage object list failed for ${bucket.id} (${listed.status}).`);
        const page = await listed.json();
        for (const item of page) {
          const objectPath = prefix ? `${prefix}/${item.name}` : item.name;
          if (item.id == null) { prefixes.push(objectPath); continue; }
          const local = `storage/${Buffer.from(bucket.id).toString('base64url')}/${Buffer.from(objectPath).toString('base64url')}`;
          const absolute = resolve(staging, local);
          await mkdir(dirname(absolute), { recursive: true, mode: 0o700 });
          const downloaded = await fetch(`${baseUrl}/storage/v1/object/authenticated/${encodeURIComponent(bucket.id)}/${objectPath.split('/').map(encodeURIComponent).join('/')}`, { headers });
          if (!downloaded.ok || !downloaded.body) throw new Error(`Storage download failed for ${bucket.id}/${objectPath} (${downloaded.status}).`);
          await pipeline(Readable.fromWeb(downloaded.body), createWriteStream(absolute, { mode: 0o600 }));
          objects.push({ bucket: bucket.id, path: objectPath, file: local });
        }
        if (page.length < 100) break;
        offset += page.length;
      }
    }
  }
  return objects;
}

export async function main() {
  const outputIndex = process.argv.indexOf('--output');
  const output = resolve(outputIndex >= 0 ? process.argv[outputIndex + 1] : `gymflow-dr-${new Date().toISOString().slice(0, 10)}.tgz.enc`);
  const dbUrl = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const passphrase = process.env.DR_BACKUP_PASSPHRASE;
  if (!dbUrl || !baseUrl || !serviceKey || !passphrase) throw new Error('SUPABASE_DB_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and DR_BACKUP_PASSPHRASE are required.');

  // A mixed set of credentials would create an internally inconsistent
  // artifact (database/Auth from one project, Storage from another). Worse,
  // its manifest would name the Storage project as the source, weakening the
  // restore guard for the real database source. Bind both inputs before the
  // first read so a copied or stale environment fails closed.
  assertRestoreTargetBinding(baseUrl, dbUrl);

  const staging = await mkdtemp(resolve(tmpdir(), 'gymflow-dr-'));
  try {
    const dump = resolve(staging, 'database.dump');
    // The connection string stays in the child environment instead of argv or
    // logs. auth contains identities/password hashes; storage contains metadata.
    await run('pg_dump', ['--format=custom', '--data-only', '--no-owner', '--no-acl', '--schema=public', '--schema=auth', '--schema=storage', '--file', dump], {
      env: postgresEnv(dbUrl),
    });
    const objects = await storageObjects(baseUrl, serviceKey, staging);
    const manifest = {
      format: DR_FORMAT,
      generated_at: new Date().toISOString(),
      source: { host: new URL(baseUrl).hostname },
      database: { file: 'database.dump', schemas: ['public', 'auth', 'storage'] },
      storage: { objects },
      config: {
        public: {
          site_url: process.env.NEXT_PUBLIC_SITE_URL ?? null,
          root_domain: process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? null,
        },
        secret_presence: Object.fromEntries(REQUIRED_SECRETS.map((name) => [name, Boolean(process.env[name])])),
        note: 'Secret values and provider credentials are intentionally absent; recover them from the credential manager.',
      },
    };
    await writeFile(resolve(staging, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    const tarPath = resolve(staging, 'archive.tgz');
    await run('tar', ['-czf', tarPath, '-C', staging, 'database.dump', 'manifest.json', ...(objects.length ? ['storage'] : [])]);
    await encryptArchive(tarPath, output, passphrase);
    console.log(`Encrypted DR artifact written: ${basename(output)}`);
    console.log(`Database/Auth + ${objects.length} Storage object(s); no secret values in manifest.`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
