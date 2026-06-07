import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/lib/database.types';

// Browser Supabase client for client components. The anon/publishable key is
// public by design; RLS enforces access. Reads NEXT_PUBLIC_* env at runtime.
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
