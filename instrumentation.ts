// Next.js instrumentation hook. Sentry's `register` runs once per server
// runtime (Node + Edge) — pick the right config by NEXT_RUNTIME.
export async function register() {
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  } else if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Forward server errors caught by Next's router/server handlers to Sentry.
export { captureRequestError as onRequestError } from '@sentry/nextjs';
