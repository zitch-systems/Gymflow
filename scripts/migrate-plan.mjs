// Pure planning logic for the migration runner (scripts/migrate.mjs).
//
// Kept free of I/O so the vitest suite can exercise it directly — the ordering
// and "what is still pending" decisions are the part that must not be wrong,
// because getting them wrong either skips a migration or replays one against a
// live database with real data in it.
//
// WHY THE LEDGER IS KEYED ON FILENAME, NOT VERSION
// The Supabase CLI keys its history on the numeric prefix, which assumes one
// migration per timestamp. This repo's history predates that convention: 39 of
// its migrations use an 8-digit date prefix and several share one — 20260713_*
// alone covers seven files. Keying on the prefix would record the first file of
// a colliding group and then silently treat its six siblings as already
// applied. So the filename (unique by construction on a filesystem) is the key,
// and the numeric prefix is used only for ordering.

import { createHash } from 'node:crypto';

/** Stable identity of a migration's contents, so an edit to an already-applied
 *  file can be detected rather than silently ignored. */
export function checksum(sql) {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

/** Split `20260713_gym_integrations.sql` into its ordering prefix and name.
 *  Returns null for anything that isn't a `<digits>_<name>.sql` migration. */
export function parseMigrationFilename(filename) {
  const m = /^(\d+)_(.+)\.sql$/.exec(filename);
  return m ? { version: m[1], name: m[2] } : null;
}

/**
 * Deterministic apply order.
 *
 * Plain lexicographic filename sort — deliberately the SAME order used by
 * scripts/shadow-db.mjs and test/setup/global.ts. The shadow DB that the
 * schema-drift gate compares against is built in that order, and the test suite
 * proves the schema it produces is correct, so applying live in any other order
 * would be verifying one thing and shipping another. Zero-padded numeric
 * prefixes make this chronological for equal-width versions, and files sharing
 * a prefix fall back to their name, which is how they already apply today.
 */
export function orderMigrations(filenames) {
  return [...filenames].filter((f) => parseMigrationFilename(f) !== null).sort();
}

/**
 * Work out what still needs to run.
 *
 * @param files   [{ filename, checksum }] — every migration in the repo
 * @param applied Record<filename, checksum> — the live ledger
 * @returns { pending, changed, alreadyApplied }
 *          pending        — in repo, not in the ledger; run these, in order
 *          changed        — in the ledger but the file's contents differ; a
 *                           previously-applied migration was edited, which the
 *                           runner treats as a hard error rather than guessing
 *          alreadyApplied — in the ledger with a matching checksum; skip
 */
export function planMigrations(files, applied) {
  const byName = new Map(files.map((f) => [f.filename, f]));
  const ordered = orderMigrations([...byName.keys()]);

  const pending = [];
  const changed = [];
  const alreadyApplied = [];

  for (const filename of ordered) {
    const file = byName.get(filename);
    const recorded = applied[filename];
    if (recorded === undefined) pending.push(file);
    else if (recorded !== file.checksum) changed.push({ ...file, recorded });
    else alreadyApplied.push(file);
  }
  return { pending, changed, alreadyApplied };
}

/** Ledger rows present live but with no file in the repo. Not fatal — the live
 *  history legitimately contains pre-baseline migrations that were squashed
 *  into 00000000000000_baseline_schema.sql — but worth surfacing. */
export function orphanedLedgerEntries(files, applied) {
  const known = new Set(files.map((f) => f.filename));
  return Object.keys(applied).filter((f) => !known.has(f)).sort();
}
