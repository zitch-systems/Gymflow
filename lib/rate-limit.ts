import 'server-only';
import { headers } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';

// Fixed-window rate limiting over Postgres (public.rate_limit_hit — see
// supabase/migrations/20260707_rate_limits.sql). Store-agnostic interface:
// if the platform later adopts Upstash/Vercel KV, only this file changes.
//
// FAIL-OPEN by design: if the service-role key is missing (preview envs) or
// the RPC errors, the request is allowed. These limits guard against abuse,
// not authorization — an outage of the limiter must never take down signup.

// Best-effort caller IP for keying. Behind Vercel, x-forwarded-for's first
// hop is the client. 'unknown' lumps unattributable traffic into one bucket,
// which is still a cap — just a shared one.
export async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    const xff = h.get('x-forwarded-for');
    return xff?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
  } catch {
    return 'unknown';
  }
}

// True → allowed; false → over the limit for this window.
export async function rateLimit(key: string, max: number, windowSeconds: number): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('rate_limit_hit', {
      p_key: key, p_max: max, p_window_seconds: windowSeconds,
    });
    if (error) {
      console.warn(`[rate-limit] ${key}: ${error.message} — failing open`);
      return true;
    }
    return data !== false;
  } catch {
    return true; // no service-role key in this environment
  }
}
