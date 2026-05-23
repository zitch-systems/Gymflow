import { NextResponse } from 'next/server';
import { initializeTransaction } from '@/lib/paystack';

// Initiates a gym-onboarding Paystack transaction. This route doesn't require
// auth (no session yet — the gym doesn't exist!) but it locks the purpose to
// 'gym_onboarding' so the verify endpoint won't accept it as a member payment.

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/;
const PLATFORM_FEE_NAIRA = 20_000;

export async function POST(request: Request) {
  let body: { gymName?: string; ownerEmail?: string; ownerName?: string; ownerPhone?: string; slug?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const slug = (body.slug ?? '').toLowerCase().trim();
  const gymName = (body.gymName ?? '').trim();
  const ownerEmail = (body.ownerEmail ?? '').trim().toLowerCase();
  const ownerName = (body.ownerName ?? '').trim();
  const ownerPhone = (body.ownerPhone ?? '').trim();

  if (!slug || !SLUG_RE.test(slug)) return NextResponse.json({ error: 'Invalid slug' }, { status: 400 });
  if (!gymName) return NextResponse.json({ error: 'Gym name required' }, { status: 400 });
  if (!ownerEmail || !/.+@.+\..+/.test(ownerEmail)) return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
  if (!ownerName) return NextResponse.json({ error: 'Owner name required' }, { status: 400 });

  try {
    const result = await initializeTransaction({
      email: ownerEmail,
      amount: PLATFORM_FEE_NAIRA,
      metadata: {
        purpose: 'gym_onboarding',
        slug,
        gym_name: gymName,
        owner_name: ownerName,
        owner_phone: ownerPhone,
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
