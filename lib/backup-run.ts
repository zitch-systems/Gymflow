import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildGymBackup, type BackupArchive } from '@/lib/backup';
import { backupStoragePath, humanSize, KEEP_BACKUPS } from '@/lib/backup-plan';
import { ATTACHMENT_LIMIT } from '@/lib/email';
import { platformAppUrl, sendPlatformEmail } from '@/lib/email/send';
import { getGymOwnerEmails } from '@/lib/email/recipients';
import { gymBackupReady } from '@/lib/email/templates/platform';
import { fmtDate, watDateISO } from '@/lib/format';

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
  /** Tables that could not be read; the archive still holds the rest. */
  problems: string[];
};

/** Cadence in the voice the email uses. */
const CADENCE: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', manual: 'On demand' };

/**
 * Record a failed attempt.
 *
 * A failure row matters more than a success one: without it, backups that stop
 * working look identical to backups that were never scheduled, and the first
 * anyone hears of it is when they need the file.
 */
async function logFailure(admin: ReturnType<typeof createAdminClient>, gymId: string, trigger: string, error: string) {
  await admin.from('gym_backups' as never).insert({
    gym_id: gymId, status: 'failed', error: error.slice(0, 500), trigger,
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

  // Store first — see the note at the top of this file.
  const path = backupStoragePath(gymId, archive.filename, now);
  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, archive.bytes, {
    contentType: 'application/zip', upsert: false,
  });
  if (upErr) {
    await logFailure(admin, gymId, opts.trigger, `upload failed: ${upErr.message}`);
    return { ok: false, gymId, size: archive.bytes.byteLength, emailed: false, error: upErr.message, problems: archive.failures };
  }

  const { error: logErr } = await admin.from('gym_backups' as never).insert({
    gym_id: gymId,
    storage_path: path,
    size_bytes: archive.bytes.byteLength,
    row_counts: archive.rowCounts,
    status: 'success',
    trigger: opts.trigger,
  } as never);
  if (logErr) {
    // The file is in storage but unlisted, so nobody can reach it. Remove it
    // rather than leave an orphan nothing points at.
    await admin.storage.from(BUCKET).remove([path]);
    return { ok: false, gymId, size: archive.bytes.byteLength, emailed: false, error: logErr.message, problems: archive.failures };
  }

  await admin.from('gyms').update({ backup_last_run_at: now.toISOString() } as never).eq('id', gymId);

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
            problems: archive.failures,
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

  return { ok: true, gymId, size: archive.bytes.byteLength, emailed, problems: archive.failures };
}
