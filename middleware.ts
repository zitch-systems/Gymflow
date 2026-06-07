import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

// Keeps the Supabase session fresh on every request. (Subdomain → gym routing
// can be layered in here later; for now auth-session refresh is the job.)
export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Run on everything except static assets + images.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|images/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
