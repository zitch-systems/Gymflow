import 'server-only';

// Minimal, dependency-free Sentry forwarder.
//
// Honors the seam documented in lib/server-error.ts: when SENTRY_DSN is set,
// forward uncaught server errors to Sentry via its public envelope endpoint; a
// no-op when it isn't. Deliberately hand-rolled (no @sentry/* SDK) so it adds
// zero dependencies and cannot affect the build, the bundle size, or the
// runtime when Sentry isn't configured. It sends a well-formed `event` envelope
// with parsed stack frames — enough for Sentry to create and group the issue.
// Swap in @sentry/nextjs later if richer telemetry (tracing, source maps,
// client-side capture) is wanted; nothing else has to change.

type SentryContext = {
  path?: string;
  method?: string;
  routeType?: string;
  level?: 'error' | 'fatal' | 'warning';
};

// DSN shape: https://<publicKey>@<host>/<projectId>
function parseDsn(dsn: string): { endpoint: string; publicKey: string } | null {
  try {
    const u = new URL(dsn);
    const publicKey = u.username;
    const projectId = u.pathname.replace(/^\//, '');
    if (!publicKey || !projectId) return null;
    return { endpoint: `${u.protocol}//${u.host}/api/${projectId}/envelope/`, publicKey };
  } catch {
    return null;
  }
}

// Best-effort stack parse into Sentry frame objects. Handles the common V8
// forms `at fn (file:line:col)` and `at file:line:col`. Sentry is lenient about
// missing fields and expects frames oldest-first, so we reverse.
function framesFromStack(stack: string | undefined) {
  if (!stack) return undefined;
  const frames = stack
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('at '))
    .map((l) => {
      const m = l.match(/^at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/);
      if (!m) return null;
      return {
        function: m[1] || '<anonymous>',
        filename: m[2],
        lineno: Number(m[3]),
        colno: Number(m[4]),
        in_app: !m[2].includes('node_modules'),
      };
    })
    .filter(Boolean)
    .reverse();
  return frames.length ? { frames } : undefined;
}

function eventId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid.replace(/-/g, '');
  // Fallback for runtimes without crypto.randomUUID.
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

export async function forwardToSentry(err: unknown, ctx: SentryContext = {}): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return; // Sentry not configured — inert.
  const parsed = parseDsn(dsn);
  if (!parsed) return;

  try {
    const e = err instanceof Error ? err : new Error(String(err));
    const id = eventId();
    const sentAt = new Date().toISOString();

    const event = {
      event_id: id,
      timestamp: Date.now() / 1000,
      platform: 'node',
      level: ctx.level ?? 'error',
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'production',
      release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
      transaction: ctx.path,
      request: ctx.path ? { url: ctx.path, method: ctx.method } : undefined,
      tags: ctx.routeType ? { route_type: ctx.routeType } : undefined,
      exception: { values: [{ type: e.name, value: e.message, stacktrace: framesFromStack(e.stack) }] },
    };

    // Sentry envelope = header line + item header line + item payload line.
    const body =
      JSON.stringify({ event_id: id, sent_at: sentAt, dsn }) + '\n' +
      JSON.stringify({ type: 'event' }) + '\n' +
      JSON.stringify(event) + '\n';

    await fetch(parsed.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${parsed.publicKey}, sentry_client=gymflow-min/1.0`,
      },
      body,
      // Telemetry must never block or hang a request that is already failing.
      signal: AbortSignal.timeout?.(3000),
    });
  } catch {
    // Swallow — error capture must never throw into the request it's reporting.
  }
}
