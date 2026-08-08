// Pure decision logic for gym backups: what is due, what a file is called,
// what never goes in, how many to keep.
//
// Deliberately free of `server-only` and of any Supabase import so the vitest
// suite exercises it directly — the same split as lib/csv.ts and
// scripts/migrate-plan.mjs. The scheduling rule in particular fails silently
// when it is wrong (a gym simply stops being backed up), which is the worst
// possible thing to leave untested.

export type BackupFrequency = 'off' | 'daily' | 'weekly' | 'monthly';

const PERIOD_DAYS: Record<Exclude<BackupFrequency, 'off'>, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
};

/**
 * Tables held back from the archive on purpose, and why.
 *
 * Written down because the instinct on a "backup" feature is to include
 * everything, and the first four of these would put payment credentials and
 * bank account numbers into a zip that gets emailed.
 */
export const EXCLUDED_TABLES: Record<string, string> = {
  saved_cards: 'payment credentials — never leaves the database',
  gym_payout_accounts: 'bank account numbers',
  instructor_bank_details: 'bank account numbers',
  payout_change_requests: 'contains bank details mid-change',
  audit_logs: 'operational log, not the gym’s record, and far larger than everything else combined',
  notifications: 'transient in-app messages',
  email_events: 'delivery telemetry',
  reminder_logs: 'delivery telemetry',
  export_logs: 'delivery telemetry',
  client_errors: 'crash telemetry',
  checkin_codes: 'short-lived one-time codes',
  platform_payments: 'GymFlow’s billing of the gym, not the gym’s own data',
};

/** How many stored archives to keep per gym. Older ones are pruned after each
 *  successful run — storage is not free, and a year of daily extracts of a
 *  member table is a liability rather than an asset. */
export const KEEP_BACKUPS = 8;

/**
 * Is a gym due for a backup?
 *
 * Compares against when the last one actually completed rather than against the
 * calendar, so a cron that didn't fire (or a gym created mid-week) catches up
 * on the next run instead of silently skipping a period. A gym that has never
 * run one is due immediately — the first backup is the one most worth having.
 *
 * The 12-hour grace stops a daily job that runs at 02:20:00 one day and
 * 02:19:58 the next from skipping a day on a technicality.
 */
export function backupDue(
  frequency: string | null | undefined,
  lastRunAt: string | Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!frequency || frequency === 'off') return false;
  if (!(frequency in PERIOD_DAYS)) return false;
  if (lastRunAt == null) return true;
  const last = lastRunAt instanceof Date ? lastRunAt : new Date(lastRunAt);
  if (Number.isNaN(last.getTime())) return true;
  const days = PERIOD_DAYS[frequency as Exclude<BackupFrequency, 'off'>];
  const elapsedHours = (now.getTime() - last.getTime()) / 3_600_000;
  return elapsedHours >= days * 24 - 12;
}

/** `backup-<slug>-<YYYY-MM-DD>.zip`. The gym name is staff-supplied and lands
 *  in a Content-Disposition header and an email filename, so it is reduced to
 *  a slug — a quote or newline there would break the header. */
export function backupFilename(gymName: string | null | undefined, on: Date): string {
  const slug = (gymName ?? 'gym').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'gym';
  return `backup-${slug}-${on.toISOString().slice(0, 10)}.zip`;
}

/**
 * Storage key inside the gym-backups bucket.
 *
 * The first segment MUST be the gym id: the bucket's RLS policy scopes reads
 * with split_part(name, '/', 1), so anything else there makes the object
 * unreadable to the gym that owns it. The timestamp keeps two runs on the same
 * day from colliding — upload() uses upsert:false, and "Back up now" after a
 * scheduled run is an ordinary thing to do.
 */
export function backupStoragePath(gymId: string, filename: string, at: Date): string {
  return `${gymId}/${at.toISOString().slice(0, 10)}-${at.getTime()}-${filename}`;
}

/** '1.2 MB' — for an email a person reads, not a log. */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
