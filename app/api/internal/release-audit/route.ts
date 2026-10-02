import { createHash, timingSafeEqual } from 'node:crypto';
import { httpSnapshot, validateHttpSnapshot, validateProductionEnvironment, validateProductionUrl } from '@/scripts/release-audit.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function digest(value: string) {
  return createHash('sha256').update(value).digest();
}

let running = false;
let nextAllowedAt = 0;

export async function POST(req: Request) {
  // CI creates a fresh, scoped credential for each release. It never pulls
  // runtime secrets, and this endpoint stops accepting the credential at expiry.
  const env = process.env;
  const secret = env.RELEASE_AUDIT_SECRET;
  const expires = Number(env.RELEASE_AUDIT_EXPIRES_AT);
  const now = Date.now();
  if (env.GYMFLOW_PRODUCTION_RELEASE !== '1' || !secret || !/^[0-9a-f]{64}$/.test(secret)
    || !Number.isSafeInteger(expires) || expires <= now || expires > now + 30 * 60_000
    || !timingSafeEqual(digest(req.headers.get('authorization') ?? ''), digest(`Bearer ${secret}`))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const releaseCommit = env.RELEASE_SHA;
  const body = await req.text();
  let requestedCommit: unknown;
  try { requestedCommit = body.length <= 256 ? JSON.parse(body).releaseCommit : undefined; } catch { /* rejected below */ }
  if (!/^[0-9a-f]{40}$/.test(releaseCommit ?? '') || requestedCommit !== releaseCommit) {
    return new Response('Release commit mismatch', { status: 409 });
  }

  const environment = validateProductionEnvironment(env);
  if (environment.errors.length) {
    return Response.json({ releaseCommit, environment: environment.checks, errors: environment.errors }, {
      status: 503, headers: { 'cache-control': 'no-store' },
    });
  }
  // Bound accidental concurrent/repeated release probes on each instance.
  if (running || now < nextAllowedAt) return new Response('Release audit already requested', { status: 429 });
  running = true;
  nextAllowedAt = now + 60_000;
  try {
    const http = await httpSnapshot(validateProductionUrl(env.NEXT_PUBLIC_SITE_URL), env.CRON_SECRET!);
    const errors = validateHttpSnapshot(http);
    return Response.json({ releaseCommit, environment: environment.checks, http, errors }, {
      status: errors.length ? 503 : 200, headers: { 'cache-control': 'no-store' },
    });
  } catch {
    // Provider bodies, customer records and credentials never enter the response.
    return Response.json({ releaseCommit, environment: environment.checks, errors: ['Runtime HTTP audit could not complete'] }, {
      status: 503, headers: { 'cache-control': 'no-store' },
    });
  } finally {
    running = false;
  }
}
