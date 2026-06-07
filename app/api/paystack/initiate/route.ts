import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { initializeTransaction } from '@/lib/paystack';
import { rateLimit, rateLimitResponse, clientIpFromRequest, readJsonBody } from '@/lib/rate-limit';

export async function POST(request: Request) {
  // Rate limit: each IP can initiate at most 10 Paystack transactions per minute.
  // Caps card-testing / cost amplification regardless of authentication status.
  const ip = clientIpFromRequest(request);
  const rl = rateLimit({ key: `paystack-initiate:${ip}`, limit: 10, windowMs: 60_000 });
  if (!rl.ok) return rateLimitResponse(rl);

  type Body = { email?: string; amount?: number; metadata?: Record<string, unknown>; callbackUrl?: string };
  const body = await readJsonBody<Body>(request);
  if (body instanceof Response) return body;

  const { email, amount, metadata, callbackUrl } = body;
  if (!email || !amount) {
    return NextResponse.json({ error: 'email and amount required' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  if (email !== user.email) {
    return NextResponse.json({ error: 'Email mismatch' }, { status: 403 });
  }

  try {
    const result = await initializeTransaction({
      email,
      amount,
      callbackUrl,
      metadata: { ...(metadata ?? {}), member_id: user.id },
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
