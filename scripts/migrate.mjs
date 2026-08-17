// Apply pending migrations to a database.
//
// WHY THIS EXISTS
// Migrations were reaching production by hand. One security migration
// (instructor_subscriptions write lockdown) sat merged-but-unapplied while the
// hole stayed open in production, and nothing caught it: the schema-drift gate
// needs SUPABASE_DB_URL, and without that secret it warns-and-skips on PRs
// (green) while failing every push to main — so main was permanently red and a
// real failure was indistinguishable from the standing one.
//
// WHY NOT `supabase db push`
// The CLI keys its history on the numeric filename prefix and assumes one
// migration per timestamp. This repo has 39 migrations on 8-digit date prefixes
// with heavy collisions (20260713_* is seven files), and the live history was
// written by hand with 14-digit versions whose names don't always match the repo
// filenames. Pointing the CLI at that would replay ~39 historical migrations
// against live data. This runner keys on the filename instead, which is unique.
//
// LEDGER
//   supabase_migrations.repo_migrations(filename pk, checksum, applied_at)
// Separate from the CLI's schema_migrations table so the existing hand-written
// history is left untouched as the historical record. Lives in the
// supabase_migrations schema, which PostgREST does not expose.
//
// Usage:
//   node scripts/migrate.mjs                 apply everything pending
//   node scripts/migrate.mjs --dry-run       show the plan, change nothing
//   node scripts/migrate.mjs --baseline      record every migration as applied
//                                            WITHOUT running it (one-time, for
//                                            a database already at head)
// Connection: SUPABASE_DB_URL or DATABASE_URL.

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { checksum, planMigrations, orphanedLedgerEntries, describeConnection } from './migrate-plan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

// One writer at a time: two CI runs merging in quick succession must not
// interleave DDL. Any connection can take this; it is released with the session.
const LOCK_KEY = 8_427_713_001;

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const baseline = args.has('--baseline');

const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('SUPABASE_DB_URL (or DATABASE_URL) is required — the direct Postgres connection string for the target database.');
  process.exit(1);
}

function readMigrations() {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .map((filename) => {
      const sql = readFileSync(join(MIGRATIONS, filename), 'utf8');
      return { filename, checksum: checksum(sql), sql };
    });
}

const client = new pg.Client({ connectionString: url });
// A failed connect is the single most common way this script is met, and pg's
// bare error ("password authentication failed for user \"postgres\"") is the same
// whatever is actually wrong with the URL. Print what we were dialling — never
// the password, only its length — so the failure says which half to go and fix.
try {
  await client.connect();
} catch (e) {
  const info = describeConnection(url);
  console.error(`\nCould not connect: ${e.message}\n`);
  if (!info.ok) {
    console.error(`SUPABASE_DB_URL is ${info.reason}.`);
  } else {
    console.error('Dialled (password never shown):');
    console.error(`  host      ${info.host}`);
    console.error(`  port      ${info.port}`);
    console.error(`  user      ${info.user}`);
    console.error(`  database  ${info.database}`);
    console.error(`  password  ${info.passwordLength} character(s)`);
    for (const note of info.notes) console.error(`  ! ${note}`);
    if (info.notes.length === 0) {
      console.error('\nThe URL is well formed, so the credential itself is being rejected —');
      console.error('reset the database password in Supabase and update the secret.');
    }
  }
  process.exit(1);
}

try {
  await client.query(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.repo_migrations (
      filename    text primary key,
      checksum    text not null,
      applied_at  timestamptz not null default now()
    );
  `);

  const { rows } = await client.query('select filename, checksum from supabase_migrations.repo_migrations');
  const applied = Object.fromEntries(rows.map((r) => [r.filename, r.checksum]));

  const files = readMigrations();
  const { pending, changed, alreadyApplied } = planMigrations(files, applied);
  const orphans = orphanedLedgerEntries(files, applied);

  console.log(`${files.length} migration(s) in repo · ${alreadyApplied.length} already applied · ${pending.length} pending`);
  for (const o of orphans) console.warn(`  ledger row with no file in repo: ${o}`);

  // An already-applied migration whose contents changed means the live database
  // and the repo disagree about what that migration DID. Re-running it is not
  // safe in general and skipping it hides the divergence, so stop and let a
  // human decide.
  if (changed.length > 0) {
    console.error('\nRefusing to run — these migrations were already applied but their contents have since changed:');
    for (const c of changed) console.error(`  ${c.filename}\n    ledger: ${c.recorded}\n    file:   ${c.checksum}`);
    console.error('\nMigrations are immutable once applied. Add a NEW migration with the correction instead.');
    process.exit(1);
  }

  if (baseline) {
    if (pending.length === 0) {
      console.log('Nothing to baseline — the ledger already covers every migration.');
    } else {
      console.log(`\nBaselining ${pending.length} migration(s) as applied WITHOUT running them:`);
      for (const f of pending) console.log(`  ${f.filename}`);
      if (dryRun) {
        console.log('\n--dry-run: nothing written.');
      } else {
        await client.query('begin');
        for (const f of pending) {
          await client.query(
            'insert into supabase_migrations.repo_migrations (filename, checksum) values ($1, $2) on conflict (filename) do nothing',
            [f.filename, f.checksum],
          );
        }
        await client.query('commit');
        console.log('\nBaseline recorded. Verify with the schema-drift gate.');
      }
    }
    process.exit(0);
  }

  if (pending.length === 0) {
    console.log('Database is up to date.');
    process.exit(0);
  }

  console.log('\nPending:');
  for (const f of pending) console.log(`  ${f.filename}`);
  if (dryRun) {
    console.log('\n--dry-run: nothing applied.');
    process.exit(0);
  }

  // Serialise concurrent runners before any DDL.
  await client.query('select pg_advisory_lock($1)', [LOCK_KEY]);

  for (const f of pending) {
    process.stdout.write(`\napplying ${f.filename} … `);
    try {
      // Each migration is its own transaction: a failure rolls that migration
      // back completely and leaves every earlier one committed, so a re-run
      // resumes from the failure instead of replaying what already succeeded.
      await client.query('begin');
      await client.query(f.sql);
      await client.query(
        'insert into supabase_migrations.repo_migrations (filename, checksum) values ($1, $2)',
        [f.filename, f.checksum],
      );
      await client.query('commit');
      console.log('ok');
    } catch (e) {
      await client.query('rollback').catch(() => {});
      console.log('FAILED');
      console.error(`\n${f.filename} failed and was rolled back: ${e.message}`);
      console.error('Earlier migrations in this run remain applied; fix the migration and re-run.');
      process.exit(1);
    }
  }
  console.log(`\nApplied ${pending.length} migration(s).`);
} finally {
  await client.end();
}
