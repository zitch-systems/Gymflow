import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { forwardToSentry } from '@/lib/sentry';

// Server-side error capture → the client_errors table (which, despite the
// name, is the platform's error log; it was previously write-orphaned) and,
// when SENTRY_DSN is configured, Sentry. Called from instrumentation.ts
// onRequestError, so this fires for every uncaught error in server components,
// server actions, and route handlers.
//
// The table is INSERT-locked by RLS (SELECT-only policy for admins), so the
// write must be service-role. Both sinks are best-effort and independent — a
// failure in one must not skip the other, and neither may throw into the
// request that is already failing.

type RequestInfo = { path: string; method: string; headers: NodeJS.Dict<string | string[]> };
type ErrorContext = { routerKind: string; routePath: string; routeType: string };

export async function captureServerError(err: unknown, request: RequestInfo, context: ErrorContext): Promise<void> {
  // Forward to Sentry first and independently of the DB write — a service-role
  // outage (the most likely reason the insert below throws) is exactly when the
  // external sink matters most. forwardToSentry is a no-op unless SENTRY_DSN is
  // set and never throws.
  await forwardToSentry(err, { path: request.path, method: request.method, routeType: context.routeType, level: 'fatal' });

  try {
    const admin = createAdminClient();
    const e = err instanceof Error ? err : new Error(String(err));
    const ua = request.headers['user-agent'];
    await admin.from('client_errors').insert({
      page: context.routePath?.slice(0, 300) ?? null,
      page_url: request.path?.slice(0, 500) ?? null,
      error_type: `server:${context.routeType ?? 'unknown'}`,
      message: `${request.method} ${e.message}`.slice(0, 2000),
      stack: e.stack?.slice(0, 8000) ?? null,
      severity: 'fatal', // reached the top of the request without being handled
      user_agent: (Array.isArray(ua) ? ua[0] : ua)?.slice(0, 300) ?? null,
    });
  } catch (captureErr) {
    // Last resort: at least leave it in the platform logs.
    console.error('[server-error] capture failed:', (captureErr as Error).message, '— original:', err);
  }
}
