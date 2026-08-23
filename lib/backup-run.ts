import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildGymBackup, type BackupArchive } from '@/lib/backup';
import { backupStoragePath, humanSize, KEEP_BACKUPS } from '@/lib/backup-plan';
import { ATTACHMENT_LIMIT } from '@/lib/email';
import { platformAppUrl, sendPlatformEmail } from '@/lib/email/send';
import { getGymOwnerEmails } from '@/lib/email/recipients';
import { gymBackupReady } from '@/lib/email/templates/platform';
import { fmtDate, watDateISO } from '@/lib/format';
import { captureServerEvent } from '@/lib/server-error';

// Running one gym's backup end to end: build the archive, store it, log the
// run, email the owners, prune old copies.
//
// Order matters and is deliberate. The archive is STORED before it is emailed,
// and the run is logged before either can fail: a backup that exists but wasn't
// delivered is a recoverable inconvenience, while one that was emailed but not
// kept leaves the console claiming a backup that isn't there.

const BUCKET = 'gym-backups';

export type BackupRunResult = {
  ok: boolean;
  gymId: string;
  /** Bytes of the produced archive, 0 on failure. */
  size: number;
  emailed: boolean;
  error?: string;
  /** Everything wrong with this run that isn't the run failing: tables that
   *  could not be read, and tables cut short by the row cap. Stored on the row,
   *  shown in Settings, and put in the email. */
  problems: string[];
};

/** Cadence in the voice the email uses. */
const CADENCE: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', manual: 'On demand' };

/**
 * Record a failed attempt, and report it.
 *
 * A failure row matters more than a success one: without it, backups that stop
 * working look identical to backups that were never scheduled, and the first
 * anyone hears of it is when they need the file. But the row is only visible to
 * whoever opens Settings → Backups, and nobody opens that page because backups
 * are working — so the failure also goes to Sentry, the same channel the money
 * paths use for handled-but-noteworthy conditions (lib/reconcile.ts).
 */
async function logFailure(
  admin: ReturnType<typeof createAdminClient>,
  gymId: string,
  trigger: string,
  error: string,
  problems: string[] = [],
) {
  void captureServerEvent('gym backup failed', { gymId, trigger, error, problems });
  await admin.from('gym_backups' as never).insert({
    gym_id: gymId, status: 'failed', error: error.slice(0, 500), trigger, problems,
  } as never);
}

/** Keep the newest KEEP_BACKUPS archives; delete the rest from storage and the
 *  log together, so the list never offers a download that 404s. */
async function prune(admin: ReturnType<typeof createAdminClient>, gymId: string): Promise<void> {
  const { data: old } = await admin.from('gym_backups' as never)
    .select('id, storage_path')
    .eq('gym_id', gymId).eq('status', 'success')
    .order('created_at', { ascending: false })
    .range(KEEP_BACKUPS, KEEP_BACKUPS + 50);
  const rows = (old ?? []) as { id: string; storage_path: string | null }[];
  if (rows.length === 0) return;
  const paths = rows.map((r) => r.storage_path).filter(Boolean) as string[];
  if (paths.length) await admin.storage.from(BUCKET).remove(paths);
  await admin.from('gym_backups' as never).delete().in('id', rows.map((r) => r.id));
}

/**
 * Build, store, log, email and prune one gym's backup.
 *
 * Never throws: the caller is either a cron iterating many gyms (where one
 * gym's failure must not abort the rest) or a button (which wants a message,
 * not a stack trace).
 */
export async function runGymBackup(
  gymId: string,
  opts: { trigger: 'scheduled' | 'manual'; cadence: string; email: boolean },
): Promise<BackupRunResult> {
  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); } catch (e) {
    return { ok: false, gymId, size: 0, emailed: false, error: (e as Error).message, problems: [] };
  }

  const now = new Date();
  const { data: gym } = await admin.from('gyms').select('id, name, slug').eq('id', gymId).maybeSingle();
  if (!gym) {
    return { ok: false, gymId, size: 0, emailed: false, error: 'gym not found', problems: [] };
  }
  const gymName = (gym.name ?? '').trim() || 'Your gym';

  let archive: BackupArchive;
  try {
    archive = await buildGymBackup(gymId, gym.name ?? null, now);
  } catch (e) {
    const msg = (e as Error).message;
    await logFailure(admin, gymId, opts.trigger, msg);
    return { ok: false, gymId, size: 0, emailed: false, error: msg, problems: [] };
  }
  const problems = [...archive.failures, ...archive.warnings];

  // Every table failed. buildGymBackup does not throw for a single table's
  // sake, so what comes back here is a valid zip of a manifest and nothing
  // else — a few hundred bytes that would store, log as 'success' and look
  // entirely normal in the console. A run that backed up nothing is a failed
  // run, and is recorded as one; the alternative is the false confidence this
  // whole feature exists to remove.
  if (archive.failures.length > 0 && Object.keys(archive.rowCounts).length === 0) {
    const msg = `no table could be read: ${archive.failures.join('; ')}`;
    await logFailure(admin, gymId, opts.trigger, msg, problems);
    return { ok: false, gymId, size: 0, emailed: false, error: msg, problems };
  }

  // Store first — see the note at the top of this file.
  const path = backupStoragePath(gymId, archive.filename, now);
  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, archive.bytes, {
    contentType: 'application/zip', upsert: false,
  });
  if (upErr) {
    await logFailure(admin, gymId, opts.trigger, `upload failed: ${upErr.message}`, problems);
    return { ok: false, gymId, size: archive.bytes.byteLength, emailed: false, error: upErr.message, problems };
  }

  // Distinguish a complete run from a partial one at the row level, not just
  // in the problems array. archive.failures are TABLES that couldn't be read
  // — those rows are missing from the archive; archive.warnings are per-table
  // notes like row-cap truncation, which mean the data IS in the archive.
  // Only real failures downgrade to 'partial'; the prune() below only counts
  // 'success' rows toward KEEP_BACKUPS so a partial cannot evict a real
  // full backup from the retention window.
  const backupStatus = archive.failures.length > 0 ? 'partial' : 'success';
  const { error: logErr } = await admin.from('gym_backups' as never).insert({
    gym_id: gymId,
    storage_path: path,
    size_bytes: archive.bytes.byteLength,
    row_counts: archive.rowCounts,
    status: backupStatus,
    trigger: opts.trigger,
    // Stored rather than only emailed: the email goes to whoever was an owner
    // that day, and a partial backup has to still be visible in Settings months
    // later, when someone is deciding whether to trust this file.
    problems,
  } as never);
  if (logErr) {
    // The file is in storage but unlisted, so nobody can reach it. Remove it
    // rather than leave an orphan nothing points at.
    await admin.storage.from(BUCKET).remove([path]);
    void captureServerEvent('gym backup could not be logged', { gymId, trigger: opts.trigger, error: logErr.message });
    return { ok: false, gymId, size: archive.bytes.byteLength, emailed: false, error: logErr.message, problems };
  }

  await admin.from('gyms').update({ backup_last_run_at: now.toISOString() } as never).eq('id', gymId);

  // A partial run is the dangerous one: it looks like a backup, it downloads
  // like a backup, and it is missing whatever failed. Reported even though the
  // run succeeded, because nothing else asks GymFlow to go and look.
  if (problems.length) {
    void captureServerEvent('gym backup completed with problems', { gymId, trigger: opts.trigger, problems });
  }

  // Email is the bonus channel; the backup already exists and is listed. An
  // archive over the attachment ceiling still gets a mail — one that points at
  // the console instead of pretending nothing happened.
  let emailed = false;
  if (opts.email && process.env.RESEND_API_KEY) {
    try {
      const to = await getGymOwnerEmails(admin, gymId);
      if (to.length) {
        const attachable = archive.bytes.byteLength <= ATTACHMENT_LIMIT;
        const counts = Object.entries(archive.rowCounts).sort((a, b) => b[1] - a[1]);
        const res = await sendPlatformEmail({
          to,
          template: 'gym_backup_ready',
          ...gymBackupReady({
            gymName,
            runOn: fmtDate(watDateISO(now)),
            cadence: CADENCE[opts.cadence] ?? 'Scheduled',
            counts,
            size: humanSize(archive.bytes.byteLength),
            backupsUrl: platformAppUrl('/admin/settings?section=backups'),
            attached: attachable,
            problems,
          }),
          ...(attachable ? { attachments: [{ filename: archive.filename, content: archive.bytes }] } : {}),
          // One mail per stored archive, so a cron retry can't send twice.
          idempotencyKey: `gym_backup:${path}`,
        });
        emailed = res.ok;
      }
    } catch { /* delivery is a bonus channel — the backup is already safe */ }
  }

  await prune(admin, gymId).catch(() => { /* pruning is housekeeping, never a failure */ });

  return { ok: true, gymId, size: archive.bytes.byteLength, emailed, problems };
}
