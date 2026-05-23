import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { initializeTransaction } from '@/lib/paystack';

export async function POST(request: Request) {
  let body: { email?: string; amount?: number; metadata?: Record<string, unknown>; callbackUrl?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

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
