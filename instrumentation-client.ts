// Client-side Sentry init. Runs once per browser tab when set.
// Next 16 auto-loads this file on the client when present.
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    // No session replay by default — it captures DOM mutations including
    // member PII / financial form inputs. Opt in per-env if you want it.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? 'development',
    sendDefaultPii: false,
  });
}

// Re-export so Next can hook router transitions for tracing.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
