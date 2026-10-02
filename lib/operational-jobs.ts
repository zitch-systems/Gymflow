import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { redactOperationalText } from '@/lib/operational-core';

type Admin = ReturnType<typeof createAdminClient>;

export async function markJobStarted(admin: Admin, job: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await admin.from('operational_job_state' as never).upsert({
    job_name: job, last_started_at: now, last_heartbeat_at: now, updated_at: now,
  } as never, { onConflict: 'job_name' });
  if (error) throw new Error(`could not start ${job} heartbeat: ${error.message}`);
}

export async function markJobHeartbeat(admin: Admin, job: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await admin.from('operational_job_state' as never)
    .update({ last_heartbeat_at: now, updated_at: now } as never).eq('job_name', job);
  if (error) throw new Error(`could not update ${job} heartbeat: ${error.message}`);
}

export async function markJobSucceeded(admin: Admin, job: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await admin.from('operational_job_state' as never).upsert({
    job_name: job,
    last_heartbeat_at: now,
    last_succeeded_at: now,
    last_error: null,
    consecutive_failures: 0,
    updated_at: now,
  } as never, { onConflict: 'job_name' });
  if (error) throw new Error(`could not complete ${job} heartbeat: ${error.message}`);
}

export async function markJobFailed(admin: Admin, job: string, error: unknown): Promise<void> {
  const message = redactOperationalText(error instanceof Error ? error.message : error);
  const { data } = await admin.from('operational_job_state' as never)
    .select('consecutive_failures').eq('job_name', job).maybeSingle();
  const failures = Number((data as { consecutive_failures?: number } | null)?.consecutive_failures ?? 0) + 1;
  const now = new Date().toISOString();
  const { error: writeError } = await admin.from('operational_job_state' as never).upsert({
    job_name: job,
    last_heartbeat_at: now,
    last_error: message,
    consecutive_failures: failures,
    updated_at: now,
  } as never, { onConflict: 'job_name' });
  if (writeError) throw new Error(`could not record ${job} failure: ${writeError.message}`);
}
