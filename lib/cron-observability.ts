// Cron observability helper. Surfaces situations where a single cron run was
// capped by MAX_ROWS_PER_RUN (so some rows are deferred to tomorrow) — silent
// today, expensive when the queue grows faster than the cron drains it.
//
// Sentry.captureMessage is a no-op when NEXT_PUBLIC_SENTRY_DSN is absent so
// dev / preview without a Sentry project remain quiet. Always writes to
// console.warn as well so the signal shows up in Vercel logs even without a
// Sentry project wired.

import * as Sentry from '@sentry/nextjs';

export type CronTelemetry = {
  /** Cron name, e.g. 'auto-debit', for the log prefix + Sentry tag. */
  cron: string;
  /** Number of rows actually processed this run. */
  processed: number;
  /** Number of rows deferred because the per-run cap was hit. */
  skipped: number;
  /** Optional extra fields surfaced alongside the message. */
  extra?: Record<string, unknown>;
};

/**
 * Call at the end of a cron's GET handler. Emits a warning when skipped > 0;
 * no-op otherwise so a healthy cron doesn't spam Sentry every day.
 */
export function reportCronCap(t: CronTelemetry): void {
  if (t.skipped <= 0) return;
  const msg = `[GF cron:${t.cron}] hit MAX_ROWS_PER_RUN cap — processed ${t.processed}, deferred ${t.skipped} to next run`;
  console.warn(msg, t.extra ?? {});
  // No-op when Sentry isn't configured.
  Sentry.captureMessage(msg, {
    level: 'warning',
    tags: { cron: t.cron, cap_hit: 'true' },
    extra: {
      processed: t.processed,
      skipped: t.skipped,
      ...(t.extra ?? {}),
    },
  });
}
