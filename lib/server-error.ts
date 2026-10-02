import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { forwardToSentry } from '@/lib/sentry';
import {
  incidentDedupeKey,
  incidentReference,
  redactOperationalText,
  safeIncidentContext,
} from '@/lib/operational-core';

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

// Explicit capture for handled-but-noteworthy conditions on the money paths
// (webhook fulfillment failures, reconciliation discrepancies, underpayment).
// These were previously console.error-only, which scrolls by unseen; this
// forwards them to Sentry as grouped events. Inert without SENTRY_DSN, never
// throws — safe to `void` from any server context.
export async function captureServerEvent(message: string, extra?: Record<string, unknown>): Promise<void> {
  const safeMessage = redactOperationalText(message, 500);
  const safeContext = safeIncidentContext(extra);
  const reference = incidentReference(extra);
  const rawError = typeof extra?.error === 'string' ? extra.error : safeMessage;
  const error = redactOperationalText(rawError);
  const dedupeKey = incidentDedupeKey(safeMessage, error, reference);

  const sentry = forwardToSentry(new Error(safeMessage), { level: 'error', extra: safeContext });
  const durable = (async () => {
    try {
      const admin = createAdminClient();
      const { error: writeError } = await admin.rpc('record_operational_incident' as never, {
        p_dedupe_key: dedupeKey,
        p_kind: safeMessage,
        p_reference: reference,
        p_error: error,
        p_context: safeContext,
      } as never);
      if (writeError) console.error('[server-error] incident write failed');
    } catch {
      console.error('[server-error] incident capture unavailable');
    }
  })();
  await Promise.allSettled([sentry, durable]);
}

export async function captureServerError(err: unknown, request: RequestInfo, context: ErrorContext): Promise<void> {
  const original = err instanceof Error ? err : new Error(String(err));
  const e = new Error(redactOperationalText(original.message));
  e.name = original.name;
  e.stack = original.stack ? redactOperationalText(original.stack, 8000) : undefined;
  const safePath = redactOperationalText(request.path?.split('?')[0] ?? '', 500);
  // Forward to Sentry first and independently of the DB write — a service-role
  // outage (the most likely reason the insert below throws) is exactly when the
  // external sink matters most. forwardToSentry is a no-op unless SENTRY_DSN is
  // set and never throws.
  await forwardToSentry(e, { path: safePath, method: request.method, routeType: context.routeType, level: 'fatal' });

  try {
    const admin = createAdminClient();
    const ua = request.headers['user-agent'];
    await admin.from('client_errors').insert({
      page: context.routePath?.slice(0, 300) ?? null,
      page_url: safePath || null,
      error_type: `server:${context.routeType ?? 'unknown'}`,
      message: `${request.method} ${e.message}`.slice(0, 2000),
      stack: e.stack?.slice(0, 8000) ?? null,
      severity: 'fatal', // reached the top of the request without being handled
      user_agent: (Array.isArray(ua) ? ua[0] : ua)?.slice(0, 300) ?? null,
    });
  } catch (captureErr) {
    // Last resort: at least leave it in the platform logs.
    console.error('[server-error] capture failed:', redactOperationalText((captureErr as Error).message));
  }
}
