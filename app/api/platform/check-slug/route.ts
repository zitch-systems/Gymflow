import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rateLimit, rateLimitResponse, clientIpFromRequest } from '@/lib/rate-limit';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/;
const RESERVED = new Set([
  'www', 'app', 'admin', 'api', 'auth', 'mail', 'staff', 'instructor',
  'superadmin', 'login', 'signup', 'join', 'help', 'support', 'gymflow',
  'about', 'pricing', 'contact', 'demo', 'test', 'dev', 'static',
]);

export async function GET(request: Request) {
  // Prevent slug enumeration / DoS: 30 checks per minute per IP is enough for
  // a single user filling the signup form, far short of useful for scraping.
  const ip = clientIpFromRequest(request);
  const rl = rateLimit({ key: `check-slug:${ip}`, limit: 30, windowMs: 60_000 });
  if (!rl.ok) return rateLimitResponse(rl);

  const url = new URL(request.url);
  const slug = (url.searchParams.get('slug') ?? '').toLowerCase().trim();

  if (!slug) return NextResponse.json({ available: false, reason: 'empty' });
  if (!SLUG_RE.test(slug)) return NextResponse.json({ available: false, reason: 'invalid' });
  if (RESERVED.has(slug)) return NextResponse.json({ available: false, reason: 'reserved' });

  const supabase = await createClient();
  const { data } = await supabase.from('gyms').select('id').eq('slug', slug).maybeSingle();
  if (data) return NextResponse.json({ available: false, reason: 'taken' });

  return NextResponse.json({ available: true });
}
