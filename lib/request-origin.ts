import 'server-only';
import { headers } from 'next/headers';
import { originForHost } from '@/lib/tenant';

/**
 * The origin of the request currently being served — "https://iron.gymflow.ng".
 *
 * Use this for any URL an external service will redirect a signed-in user back
 * to. Sessions are host-scoped, so a callback that lands on a different host
 * than the user started on arrives signed out.
 *
 * The rules live in originForHost (pure, tested); this only supplies the
 * headers. Behind Vercel the original host is x-forwarded-host — `host` is the
 * internal one on some paths, so the forwarded value wins.
 */
export async function requestOrigin(): Promise<string> {
  try {
    const h = await headers();
    return originForHost(
      h.get('x-forwarded-host') ?? h.get('host'),
      h.get('x-forwarded-proto'),
      process.env.NEXT_PUBLIC_SITE_URL,
    );
  } catch {
    // No request context (a script, a cron run) — the configured site URL is
    // the only sensible answer.
    return (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/+$/, '');
  }
}
