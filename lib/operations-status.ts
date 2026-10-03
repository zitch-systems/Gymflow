export const OPERATIONAL_JOB_SCHEDULES = {
  notifications: { label: 'notifications', overdueAfterMs: 26 * 60 * 60 * 1000 },
  gym_backups: { label: 'gym backups', overdueAfterMs: 30 * 60 * 1000 },
  paystack_reconciliation: { label: 'paystack reconciliation', overdueAfterMs: 30 * 60 * 1000 },
  payment_webhook_recovery: { label: 'payment webhook recovery', overdueAfterMs: 10 * 60 * 1000 },
} as const;

export type OperationalJobName = keyof typeof OPERATIONAL_JOB_SCHEDULES;

type JobTiming = {
  last_succeeded_at: string | null;
  consecutive_failures: number;
};

export type JobDisplayStatus = {
  label: string;
  tone: 'healthy' | 'danger';
};

export function jobDisplayStatus(
  jobName: OperationalJobName,
  job: JobTiming | undefined,
  nowMs = Date.now(),
): JobDisplayStatus {
  if (!job?.last_succeeded_at) return { label: 'Never run', tone: 'danger' };
  if (job.consecutive_failures > 0) {
    return { label: `${job.consecutive_failures} failed`, tone: 'danger' };
  }

  const succeededAt = Date.parse(job.last_succeeded_at);
  if (!Number.isFinite(succeededAt)) return { label: 'Invalid timestamp', tone: 'danger' };
  if (nowMs - succeededAt > OPERATIONAL_JOB_SCHEDULES[jobName].overdueAfterMs) {
    return { label: 'Overdue', tone: 'danger' };
  }
  return { label: 'Healthy', tone: 'healthy' };
}
