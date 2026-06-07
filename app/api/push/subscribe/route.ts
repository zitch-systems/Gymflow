import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/dal';

export const runtime = 'nodejs';

type SubscribeBody = {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
  gymId?: string | null;
};

// POST: upsert the caller's push subscription for this device.
// RLS (push_sub_insert_self) constrains writes to the caller; we use the
// user-scoped client so the policy applies rather than the service key.
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

  let body: SubscribeBody;
  try {
    body = (await request.json()) as SubscribeBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'Bad JSON' }, { status: 400 });
  }

  const endpoint = body.endpoint;
  const p256dh = body.keys?.p256dh;
  const auth = body.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ ok: false, error: 'Incomplete subscription' }, { status: 400 });
  }

  const supabase = await createClient();
  // Upsert on (user_id, endpoint) so re-subscribing the same device is
  // idempotent and refreshes rotated keys.
  const { error } = await supabase.from('push_subscriptions' as never).upsert(
    {
      user_id: user.id,
      gym_id: body.gymId ?? null,
      endpoint,
      p256dh,
      auth,
      user_agent: request.headers.get('user-agent')?.slice(0, 300) ?? null,
    } as never,
    { onConflict: 'user_id,endpoint' } as never,
  );

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE: remove a subscription by endpoint (device opted out / unsubscribed).
export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

  let body: { endpoint?: string };
  try {
    body = (await request.json()) as { endpoint?: string };
  } catch {
    return NextResponse.json({ ok: false, error: 'Bad JSON' }, { status: 400 });
  }
  if (!body.endpoint) return NextResponse.json({ ok: false, error: 'endpoint required' }, { status: 400 });

  const supabase = await createClient();
  const { error } = await supabase
    .from('push_subscriptions' as never)
    .delete()
    .eq('endpoint' as never, body.endpoint);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
