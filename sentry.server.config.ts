import * as Sentry from '@sentry/nextjs';

// Server-side Sentry initialisation. No-ops when the DSN env var is absent so
// local dev / preview builds without a Sentry project just skip reporting.
const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    // Conservative sampling so we don't blow through a free-tier quota.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    profilesSampleRate: Number(process.env.SENTRY_PROFILES_SAMPLE_RATE ?? '0'),
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    // Don't leak request bodies — gym member PII (NOK, health notes) sits in
    // form payloads we'd otherwise capture by default.
    sendDefaultPii: false,
  });
}
