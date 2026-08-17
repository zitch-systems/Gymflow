import { requireApiMember, json, corsPreflight, readJson, publicGym } from '@/lib/api-app';
import { splitName, normalizeNgPhone } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export function OPTIONS() {
  return corsPreflight();
}

// GET /api/app/profile — identity, lifetime counts and the membership state the
// profile screen renders (including whether this gym allows freeze requests).
export async function GET(req: Request) {
  const auth = await requireApiMember(req);
  if (!auth.ok) return auth.res;
  const { supabase, user, gym, link } = auth.ctx;

  try {
    const [{ data: profile }, { count: visits }, { count: classes }, { data: sub }] = await Promise.all([
      supabase.from('profiles')
        .select('id, email, full_name, first_name, last_name, phone, date_of_birth, gender, address, emergency_contact_name, emergency_contact_phone, notification_email')
        .eq('id', user.id).maybeSingle(),
      supabase.from('check_ins').select('id', { count: 'exact', head: true }).eq('member_id', user.id).eq('gym_id', gym.id),
      supabase.from('class_bookings').select('id', { count: 'exact', head: true }).eq('member_id', user.id).eq('gym_id', gym.id).eq('status', 'attended'),
      supabase.from('member_subscriptions')
        .select('id, status, end_date, auto_debit_enabled, paystack_subscription_code')
        .eq('member_id', user.id).eq('gym_id', gym.id)
        .in('status', ['active', 'pause_requested', 'paused', 'past_due'])
        .order('end_date', { ascending: false }).limit(1).maybeSingle(),
    ]);

    return json({
      gym: publicGym(gym),
      profile: {
        id: user.id,
        email: profile?.email ?? user.email ?? null,
        full_name: profile?.full_name ?? ([profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || null),
        phone: profile?.phone ?? null,
        date_of_birth: profile?.date_of_birth ?? null,
        gender: profile?.gender ?? null,
        address: profile?.address ?? null,
        emergency_contact_name: profile?.emergency_contact_name ?? null,
        emergency_contact_phone: profile?.emergency_contact_phone ?? null,
        notification_email: profile?.notification_email !== false,
        joined_at: link.joined_at ?? null,
      },
      stats: { visits: visits ?? 0, classes_attended: classes ?? 0 },
      membership: sub
        ? {
            status: sub.status,
            end_date: sub.end_date,
            auto_renew: Boolean(sub.auto_debit_enabled && sub.paystack_subscription_code),
          }
        : null,
      // Whether the member may ask for a freeze at all is the gym's setting, so
      // the app hides the row rather than offering a button that always fails.
      freeze_enabled: (gym as { member_freeze_enabled?: boolean }).member_freeze_enabled !== false,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}

// PATCH /api/app/profile — the member edits their own details.
//
// Runs on the member's own token: RLS (profiles_update_no_escalation) pins the
// row to auth.uid() and refuses any role change, so there is nothing here that
// a hand-rolled request could escalate. Only the fields the edit screen shows
// are read off the body — anything else in it is ignored rather than trusted.
export async function PATCH(req: Request) {
  const auth = await requireApiMember(req);
  if (!auth.ok) return auth.res;
  const { supabase, user } = auth.ctx;

  const body = await readJson(req);
  const fullName = String(body.full_name ?? '').trim().slice(0, 120);
  if (!fullName) return json({ error: 'Your name is required.' }, 400);

  const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max) || null;

  // A phone that doesn't normalise is rejected, not quietly dropped: silently
  // storing null for a mis-typed number leaves the member believing the gym can
  // reach them. The emergency contact's number is kept as typed — it may be a
  // landline, or not Nigerian at all.
  const rawPhone = String(body.phone ?? '').trim();
  const phone = rawPhone ? normalizeNgPhone(rawPhone) : null;
  if (rawPhone && !phone) return json({ error: 'Enter a valid Nigerian phone number, e.g. 0803 123 4567.' }, 400);

  try {
    // full_name is GENERATED in the live DB — write the split parts, never the
    // generated column.
    const { error } = await supabase.from('profiles').update({
      ...splitName(fullName),
      phone,
      date_of_birth: str(body.date_of_birth, 10),
      gender: str(body.gender, 24),
      address: str(body.address, 300),
      emergency_contact_name: str(body.emergency_contact_name, 120),
      emergency_contact_phone: str(body.emergency_contact_phone, 32),
      updated_at: new Date().toISOString(),
    }).eq('id', user.id);
    if (error) return json({ ok: false, error: error.message }, 422);
    return json({ ok: true });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}
