import { cronAuthorized } from '@/lib/cron-auth';
import { runGymBackup } from '@/lib/backup-run';
import { backupQueueHealth, claimDueBackupJobs, finishBackupJob } from '@/lib/backup-queue';
import { createAdminClient } from '@/lib/supabase/admin';
import { captureServerEvent } from '@/lib/server-error';
import { markJobFailed, markJobStarted, markJobSucceeded } from '@/lib/operational-jobs';
import { redactOperationalText } from '@/lib/operational-core';
import { isOfflineGym } from '@/lib/gym-status';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// One archive holds an entire gym in memory. Sequential processing plus a
// durable oldest-first queue bounds memory and lets later invocations resume.
const MAX_PER_RUN = 20;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response('Unauthorized', { status: 401 });

  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); }
  catch { return Response.json({ ok: false, error: 'service role unavailable' }, { status: 503 }); }

  try {
    await markJobStarted(admin, 'gym_backups');
    const { lockToken, jobs } = await claimDueBackupJobs(admin, MAX_PER_RUN);
    const results = [];
    for (const job of jobs) {
      // The gym may be suspended after it was enqueued. The claim returns the
      // current status so the worker does not create or email a stale archive.
      if (isOfflineGym({ status: job.gym_status })) {
        await finishBackupJob(admin, job, lockToken, { complete: true });
        continue;
      }
      const result = await runGymBackup(job.gym_id, {
        trigger: 'scheduled', cadence: job.backup_frequency,
        email: job.backup_email !== false,
      });
      await finishBackupJob(admin, job, lockToken, {
        complete: result.complete,
        error: result.error ?? (result.complete ? undefined : result.problems.join('; ') || 'backup was incomplete'),
      });
      results.push(result);
    }

    const queue = await backupQueueHealth(admin);
    const oldestAgeHours = queue.oldestDueAt
      ? Math.max(0, (Date.now() - new Date(queue.oldestDueAt).getTime()) / 3_600_000)
      : 0;
    if (oldestAgeHours >= 48) {
      await captureServerEvent('gym backup queue is overdue', {
        job: 'gym_backups', count: queue.queued, status: 'overdue',
      });
    }

    const incomplete = results.filter((r) => !r.complete);
    if (incomplete.length) {
      await markJobFailed(admin, 'gym_backups', `${incomplete.length} scheduled backups remain incomplete`);
      return Response.json({
        ok: false, claimed: jobs.length,
        completed: results.length - incomplete.length,
        retrying: incomplete.map((r) => ({ gym: r.gymId, error: redactOperationalText(r.error ?? r.problems[0] ?? 'incomplete', 300) })),
        queue: { ...queue, oldestAgeHours: Math.round(oldestAgeHours * 10) / 10 },
      }, { status: 500 });
    }

    await markJobSucceeded(admin, 'gym_backups');
    return Response.json({
      ok: true, claimed: jobs.length, completed: results.length,
      emailed: results.filter((r) => r.emailed).length,
      queue: { ...queue, oldestAgeHours: Math.round(oldestAgeHours * 10) / 10 },
    });
  } catch (e) {
    await markJobFailed(admin, 'gym_backups', e).catch(() => undefined);
    return Response.json({ ok: false, error: 'backup worker failed' }, { status: 500 });
  }
}
