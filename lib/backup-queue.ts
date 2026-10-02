import 'server-only';
import { randomUUID } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { redactOperationalText, retryDelaySeconds } from '@/lib/operational-core';

type Admin = ReturnType<typeof createAdminClient>;

export type BackupJob = {
  gym_id: string;
  gym_name: string | null;
  gym_status: string | null;
  backup_frequency: string;
  backup_email: boolean;
  attempts: number;
  due_at: string;
};

export async function claimDueBackupJobs(admin: Admin, limit: number): Promise<{ lockToken: string; jobs: BackupJob[] }> {
  const { error: enqueueError } = await admin.rpc('enqueue_due_gym_backup_jobs' as never);
  if (enqueueError) throw new Error(`could not enqueue due backups: ${redactOperationalText(enqueueError.message)}`);
  const lockToken = randomUUID();
  const { data, error } = await admin.rpc('claim_due_gym_backup_jobs' as never, {
    p_limit: limit, p_lock_token: lockToken,
  } as never);
  if (error) throw new Error(`could not claim due backups: ${redactOperationalText(error.message)}`);
  return { lockToken, jobs: (data ?? []) as unknown as BackupJob[] };
}

export async function finishBackupJob(
  admin: Admin,
  job: BackupJob,
  lockToken: string,
  result: { complete: boolean; error?: string },
): Promise<void> {
  if (result.complete) {
    const { data, error } = await admin.from('gym_backup_jobs' as never).delete()
      .eq('gym_id', job.gym_id).eq('status', 'processing').eq('lock_token', lockToken)
      .select('gym_id');
    if (error || !data || data.length === 0) throw new Error(`could not complete backup job: ${redactOperationalText(error?.message ?? 'claim was lost')}`);
    return;
  }

  const next = new Date(Date.now() + retryDelaySeconds(job.attempts) * 1000).toISOString();
  const { data, error } = await admin.from('gym_backup_jobs' as never).update({
    status: 'retry', next_attempt_at: next,
    last_error: redactOperationalText(result.error ?? 'backup was incomplete'),
    locked_at: null, lock_token: null, updated_at: new Date().toISOString(),
  } as never)
    .eq('gym_id', job.gym_id).eq('status', 'processing').eq('lock_token', lockToken)
    .select('gym_id');
  if (error || !data || data.length === 0) throw new Error(`could not retry backup job: ${redactOperationalText(error?.message ?? 'claim was lost')}`);
}

export async function backupQueueHealth(admin: Admin): Promise<{ queued: number; oldestDueAt: string | null }> {
  const [{ count, error: countError }, { data, error: oldestError }] = await Promise.all([
    admin.from('gym_backup_jobs' as never).select('gym_id', { count: 'exact', head: true }),
    admin.from('gym_backup_jobs' as never).select('due_at').order('due_at', { ascending: true }).limit(1).maybeSingle(),
  ]);
  if (countError || oldestError) throw new Error(`could not inspect backup queue: ${redactOperationalText((countError ?? oldestError)?.message)}`);
  return { queued: count ?? 0, oldestDueAt: (data as { due_at?: string } | null)?.due_at ?? null };
}
