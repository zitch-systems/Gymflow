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

// ── Connection diagnostics ─────────────────────────────────────────────────
//
// A wrong SUPABASE_DB_URL fails as a bare pg stack trace — `password
// authentication failed for user "postgres"` and nothing else. That message is
// the same whether the URL points at the direct host or the pooler, whether the
// password is empty, still the literal [YOUR-PASSWORD] placeholder, or simply
// wrong. GitHub masks the secret in logs, so an operator staring at the failure
// cannot tell which of those they are looking at, and the only way to find out
// is to guess and re-run.
//
// This describes the connection WITHOUT ever revealing the password: host, port,
// user, database, and the password's LENGTH. That is enough to separate "the
// value in the secret is the wrong shape" from "the shape is right and the
// password is wrong", which are fixed in completely different places.

/** decodeURIComponent throws on a lone '%'; a malformed escape is itself worth
 *  reporting, so fall back to the raw form rather than blowing up the report. */
function safeDecode(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

/** Common ways a Supabase connection string arrives broken. */
function connectionNotes({ raw, host, port, user, password }) {
  const notes = [];

  if (raw !== raw.trim()) notes.push('value has leading/trailing whitespace (a trailing newline is the usual cause) — it becomes part of the password');
  if (password === '') notes.push('no password in the URL — nothing between the ":" and the "@"');
  else if (/[[\]]/.test(password) || /your.?password/i.test(password)) notes.push('password still looks like the [YOUR-PASSWORD] placeholder');

  if (port === '6543') notes.push('port 6543 is the TRANSACTION pooler — the runner takes a session-scoped advisory lock, so it needs the SESSION pooler on 5432');
  if (host.endsWith('.pooler.supabase.com') && !user.includes('.')) {
    notes.push(`pooler host with user "${user}" — the pooler expects the tenant-qualified form, e.g. postgres.<project-ref>`);
  }
  if (/^db\..*\.supabase\.co$/.test(host)) {
    notes.push('direct connection host — resolves over IPv6 only unless the IPv4 add-on is enabled, which GitHub-hosted runners cannot reach');
  }

  return notes;
}

/**
 * A redacted, human-readable description of a Postgres connection string.
 *
 * Returns `{ ok: false, reason }` when the value is not a parseable URL at all —
 * itself a useful answer, and the one an operator gets when a stray character
 * makes it into the secret.
 */
export function describeConnection(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, reason: 'empty' };

  // Checked before parsing, because a leading quote breaks the scheme and would
  // otherwise surface as the generic "not a parseable URL" — true, but it hides
  // the actual mistake, which is invisible in a secrets UI.
  if (/^["'].*["']$/s.test(raw.trim())) {
    return { ok: false, reason: 'wrapped in quotes — a secret store keeps them literally, so they become part of the URL' };
  }

  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'not a parseable URL — check for spaces, quotes or a missing postgresql:// prefix' };
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) {
    return { ok: false, reason: `unexpected scheme "${u.protocol.replace(':', '')}" — expected postgresql://` };
  }

  // WHATWG URL hands these back still percent-ENCODED, so decode before
  // measuring: the length that matters is the password the server actually
  // receives, which is exactly the number that exposes an unencoded special
  // character (the encoded form is longer than what was typed).
  const password = safeDecode(u.password);
  const user = safeDecode(u.username);

  return {
    ok: true,
    host: u.hostname,
    port: u.port || '5432',
    user,
    database: u.pathname.replace(/^\//, '') || '(none)',
    passwordLength: password.length,
    notes: connectionNotes({ raw, host: u.hostname, port: u.port || '5432', user, password }),
  };
}
