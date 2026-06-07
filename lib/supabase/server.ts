import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/lib/database.types';

// Server Supabase client for Server Components, Route Handlers, and Server
// Actions. Bound to the request's cookies so the user's session (and therefore
// RLS) applies. In a pure Server Component the cookie setters are no-ops
// (Next forbids writes there) — the middleware refreshes the session instead.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — safe to ignore; middleware
            // (lib/supabase/middleware.ts) keeps the session fresh.
          }
        },
      },
    },
  );
}
