-- What went wrong on a backup run, kept with the run.
--
-- gym_backups could record 'success' or 'failed' and nothing in between, but
-- the interesting state is in between: buildGymBackup deliberately does not
-- abort when one table fails to read, and it caps each table at 50,000 rows.
-- Both produce a real, downloadable archive that is missing something, and
-- neither reached storage — archive.failures was passed to the email and then
-- dropped. So Settings → Backups showed a normal-looking row for a backup with
-- a hole in it, and the owner found out when they needed the file.
--
--   problems — one line per table that failed to read or was cut short by the
--              row cap, e.g. {'payments: only the most recent 50,000 rows are
--              included'}. Empty on a clean run.
--
-- The status vocabulary is deliberately left alone. A partial run is still a
-- success — the archive exists and most of it is good — and adding a third
-- status would mean widening a check constraint that live rows already satisfy
-- for a distinction `problems` already carries.
--
-- Live data: every existing row predates this and simply gets the default. The
-- column is NOT NULL DEFAULT, which Postgres 11+ applies as a catalogue-only
-- change (no table rewrite), so this is safe on a table that grows one row per
-- gym per run. Additive + idempotent.

alter table public.gym_backups
  add column if not exists problems text[] not null default '{}'::text[];

comment on column public.gym_backups.problems is
  'Tables that failed to read or were truncated by the row cap on this run. Empty means the archive is complete. A run where NOTHING could be read is recorded as status=failed rather than as a success with problems — see lib/backup-run.ts.';
