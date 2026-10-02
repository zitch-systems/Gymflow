import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, open, stat, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

const MAGIC = Buffer.from('GFDR0001');
const HEADER_BYTES = MAGIC.length + 16 + 12;
const TAG_BYTES = 16;

function derive(passphrase, salt) {
  if (typeof passphrase !== 'string' || passphrase.length < 20) {
    throw new Error('DR_BACKUP_PASSPHRASE must be at least 20 characters.');
  }
  return scryptSync(passphrase, salt, 32, { N: 1 << 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
}

export async function encryptArchive(input, output, passphrase) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', derive(passphrase, salt), iv);
  await writeFile(output, Buffer.concat([MAGIC, salt, iv]), { mode: 0o600 });
  await pipeline(createReadStream(input), cipher, createWriteStream(output, { flags: 'a', mode: 0o600 }));
  await appendFile(output, cipher.getAuthTag());
}

export async function decryptArchive(input, output, passphrase) {
  const info = await stat(input);
  if (info.size <= HEADER_BYTES + TAG_BYTES) throw new Error('Backup artifact is truncated.');
  const handle = await open(input, 'r');
  try {
    const header = Buffer.alloc(HEADER_BYTES);
    const tag = Buffer.alloc(TAG_BYTES);
    await handle.read(header, 0, HEADER_BYTES, 0);
    await handle.read(tag, 0, TAG_BYTES, info.size - TAG_BYTES);
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Unsupported backup artifact version.');
    const salt = header.subarray(MAGIC.length, MAGIC.length + 16);
    const iv = header.subarray(MAGIC.length + 16);
    const decipher = createDecipheriv('aes-256-gcm', derive(passphrase, salt), iv);
    decipher.setAuthTag(tag);
    await pipeline(
      createReadStream(input, { start: HEADER_BYTES, end: info.size - TAG_BYTES - 1 }),
      decipher,
      createWriteStream(output, { mode: 0o600 }),
    );
  } finally {
    await handle.close();
  }
}

export function assertIsolatedRestore({ ack, sourceHost, targetHost }) {
  if (ack !== 'ISOLATED_ONLY') throw new Error('Set DR_RESTORE_ACK=ISOLATED_ONLY to enable restore mode.');
  if (!targetHost) throw new Error('The isolated target host is missing.');
  if (sourceHost && String(sourceHost).toLowerCase() === String(targetHost).toLowerCase()) throw new Error('Refusing to restore into the source project.');
  if (!isLoopbackHost(targetHost) && !projectRefFromApiHost(targetHost)) {
    throw new Error('Target is not recognisable as an isolated Postgres/Supabase host.');
  }
}

function isLoopbackHost(host) {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(String(host).toLowerCase());
}

function projectRefFromApiHost(host) {
  const match = /^([a-z0-9]+)\.supabase\.(?:co|net)$/i.exec(String(host));
  return match?.[1]?.toLowerCase() ?? null;
}

/** Prove the database and API URLs name the same isolated target. Supabase's
 * direct database hostname embeds the project ref in the host. Shared pooler
 * hosts instead bind it in the exact `postgres.<ref>` username. */
export function assertRestoreTargetBinding(apiUrl, databaseUrl) {
  const api = new URL(apiUrl);
  const database = new URL(databaseUrl);
  const apiHost = api.hostname.toLowerCase();
  const databaseHost = database.hostname.toLowerCase();
  if (isLoopbackHost(apiHost)) {
    if (!isLoopbackHost(databaseHost)) throw new Error('Database and API targets do not belong to the same isolated project.');
    return;
  }

  const ref = projectRefFromApiHost(apiHost);
  if (!ref) throw new Error('Target is not recognisable as an isolated Postgres/Supabase host.');
  const direct = databaseHost === `db.${ref}.supabase.co` || databaseHost === `db.${ref}.supabase.net`;
  const pooler = /^(?:[a-z0-9-]+\.)+pooler\.supabase\.com$/i.test(databaseHost)
    && decodeURIComponent(database.username).toLowerCase() === `postgres.${ref}`;
  if (!direct && !pooler) throw new Error('Database and API targets do not belong to the same isolated project.');
}

/** Keep database credentials out of process arguments while giving libpq the
 * individual variables it expects. PGDATABASE does not accept a URL. */
export function postgresEnv(connectionString, base = process.env) {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Database URL must use postgres:// or postgresql://.');
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!url.hostname || !database) throw new Error('Database URL must include a host and database name.');
  const env = {
    ...base,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: database,
  };
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}

export const DR_FORMAT = {
  version: 1,
  encryption: 'AES-256-GCM',
  kdf: 'scrypt N=131072 r=8 p=1',
  salt: '16 random bytes per artifact',
  iv: '12 random bytes per artifact',
};
