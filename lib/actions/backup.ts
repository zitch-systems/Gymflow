'use server';

import { revalidatePath } from 'next/cache';
import { requireStaff, MANAGER_ROLES } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logAudit } from '@/lib/audit';
import { rateLimit } from '@/lib/rate-limit';
import { runGymBackup } from '@/lib/backup-run';

// Settings → Backups. Manager-and-above throughout: this surface hands out a
// full export of the gym's members and payments, which is not front-desk work.

export type BackupState = { ok: boolean; error: string | null; message?: string };

const FREQUENCIES = new Set(['off', 'daily', 'weekly', 'monthly']);

/** Save the schedule. Frequency is validated against the same set the database
 *  check constraint enforces, so a hand-posted value is rejected here with a
 *  readable message rather than as a constraint violation. */
export async function saveBackupSettings(_prev: BackupState, formData: FormData): Promise<BackupState> {
  const frequency = String(formData.get('backup_frequency') ?? 'off');
  // Unchecked boxes don't post — presence is the whole signal.
  const email = formData.get('backup_email') === 'on';
  if (!FREQUENCIES.has(frequency)) return { ok: false, error: 'Pick a valid backup schedule.' };
  try {
    const { user, gym } = await requireStaff(MANAGER_ROLES);
    const supabase = await createClient();
    const { error } = await supabase.from('gyms')
      .update({ backup_frequency: frequency, backup_email: email } as never)
      .eq('id', gym.id);
    if (error) return { ok: false, error: error.message };
    logAudit({
      action: 'backup_settings_updated', table: 'gyms',
      actorId: user.id, gymId: gym.id, recordId: gym.id,
      values: { backup_frequency: frequency, backup_email: email },
    });
    try { revalidatePath('/admin/settings'); } catch { /* stale cache is tolerable */ }
    return {
      ok: true,
      error: null,
      message: frequency === 'off' ? 'Automatic backups turned off.' : `Backing up ${frequency}.`,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Back up now.
 *
 * Rate limited because each call reads and zips the gym's entire dataset — the
 * most expensive thing a button on this console can do, and trivially held down
 * by someone impatient. Three an hour is more than any legitimate use.
 */
export async function runBackupNow(_prev: BackupState, _formData: FormData): Promise<BackupState> {
  try {
    const { user, gym } = await requireStaff(MANAGER_ROLES);
    if (!(await rateLimit(`backup:gym:${gym.id}`, 3, 3600))) {
      return { ok: false, error: 'A few backups have run already — try again in a little while.' };
    }
    const res = await runGymBackup(gym.id, {
      trigger: 'manual',
      cadence: 'manual',
      // A manual run follows the gym's own delivery preference: someone who
      // switched email off doesn't want a mail because they pressed a button.
      email: (gym as { backup_email?: boolean | null }).backup_email !== false,
    });
    logAudit({
      action: res.ok ? 'backup_created' : 'backup_failed', table: 'gym_backups',
      actorId: user.id, gymId: gym.id, recordId: gym.id,
      values: { size: res.size, emailed: res.emailed, error: res.error ?? null },
    });
    try { revalidatePath('/admin/settings'); } catch { /* stale cache is tolerable */ }
    if (!res.ok) return { ok: false, error: res.error ?? 'Backup failed.' };
    // Partial success is reported as such — "Backup complete" over a run that
    // silently dropped a table is exactly the false confidence this feature is
    // supposed to remove.
    const problems = res.problems.length ? ` Some tables could not be read: ${res.problems.join('; ')}.` : '';
    return {
      ok: true,
      error: null,
      message: `${res.emailed ? 'Backup created and emailed.' : 'Backup created.'}${problems}`,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type BackupDownload = { ok: true; url: string } | { ok: false; error: string };

/**
 * A short-lived signed URL for one stored archive.
 *
 * The bucket is private and its read policy is owner/manager-scoped, but the
 * download happens in a browser tab that carries no Supabase session — so the
 * link is minted here, after requireStaff, with the row re-checked against the
 * caller's gym. Sixty seconds is enough to start a download and short enough
 * that a link pasted anywhere is already dead.
 */
export async function backupDownloadUrl(backupId: string): Promise<BackupDownload> {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(backupId)) return { ok: false, error: 'Backup not found.' };
  try {
    const { gym } = await requireStaff(MANAGER_ROLES);
    const admin = createAdminClient();
    const { data } = await admin.from('gym_backups' as never)
      .select('id, gym_id, storage_path')
      .eq('id', backupId).eq('gym_id', gym.id)
      .maybeSingle();
    // gym_backups postdates the checked-in generated types, so the row comes
    // back as `never` — same pattern as gym_payout_accounts elsewhere.
    const row = data as unknown as { storage_path: string | null } | null;
    if (!row?.storage_path) return { ok: false, error: 'Backup not found.' };
    const { data: signed, error } = await admin.storage.from('gym-backups').createSignedUrl(row.storage_path, 60);
    if (error || !signed?.signedUrl) return { ok: false, error: error?.message ?? 'Could not open that backup.' };
    return { ok: true, url: signed.signedUrl };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
