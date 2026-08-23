import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

// Service-role client — bypasses RLS. Use ONLY in trusted server paths
// (Paystack webhooks, cron, verified payment writes, capacity counts).
// Never import this into a client component. Requires SUPABASE_SERVICE_ROLE_KEY.
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Named-env checks: the previous `url!` swallowed a missing var and
  // failed downstream with an opaque `TypeError: Invalid URL` from
  // supabase-js — no hint about which secret to set. Fail early and name
  // it so `apply migrations to live` / webhook handlers say what's wrong.
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  return createSupabaseClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
