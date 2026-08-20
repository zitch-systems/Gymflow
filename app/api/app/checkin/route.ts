import { requireApiMember, json, corsPreflight, readJson, planLocked } from '@/lib/api-app';
import { gymCanUse } from '@/lib/entitlements';
import { checkInCore, checkOutCore, generateCodeCore, openVisit } from '@/lib/checkin-core';
import { watDateISO, watDayStartUtc } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export function OPTIONS() {
  return corsPreflight();
}

type Visit = {
  id: string;
  checked_in_at: string | null;
  checked_out_at: string | null;
  status: string | null;
  check_in_method: string | null;
};

// GET /api/app/checkin — am I inside, and what have my recent visits been?
// The app polls this while a front-desk code is on screen, so it stays cheap:
// one query, and the "checked in" answer derived from it rather than a second.
export async function GET(req: Request) {
  const auth = await requireApiMember(req);
  if (!auth.ok) return auth.res;
  const { supabase, user, gym } = auth.ctx;

  try {
    const { data } = await supabase
      .from('check_ins').select('id, checked_in_at, checked_out_at, status, check_in_method')
      .eq('member_id', user.id).eq('gym_id', gym.id)
      .order('checked_in_at', { ascending: false })
      .limit(15);

    const history = (data ?? []) as Visit[];
    const dayStartIso = watDayStartUtc(watDateISO());
    const open = history.find((c) => c.status === 'active' && !c.checked_out_at && (c.checked_in_at ?? '') >= dayStartIso) ?? null;

    return json({
      checked_in: Boolean(open),
      checked_in_at: open?.checked_in_at ?? null,
      history: history.map((v) => ({
        id: v.id,
        checked_in_at: v.checked_in_at,
        checked_out_at: v.checked_out_at,
        status: v.status,
        method: v.check_in_method,
      })),
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}

// POST /api/app/checkin — { action: 'in' | 'out' | 'code' }.
//
// Every gate (gym switched off, suspended link, lapsed membership) is enforced
// in lib/checkin-core.ts, the same module the web Server Actions call. Being on
// a phone is not a way past the turnstile.
export async function POST(req: Request) {
  const auth = await requireApiMember(req);
  if (!auth.ok) return auth.res;
  const { supabase, user, gym } = auth.ctx;

  const body = await readJson(req);
  const action = String(body.action ?? '');

  // Opening the door is qr_checkin, a Growth feature in its own right — every
  // door/print/WhatsApp QR deep-links into the member app, which is why the two
  // travel together in lib/entitlements.ts. requireApiMember has already refused
  // a gym without member_app, so this only bites if the two ever come apart;
  // naming the feature the branch actually needs is what stops that reopening
  // the door silently. gymCanUse, not gymHasFeature — qr_checkin is one of the
  // grandfathered surfaces.
  //
  // 'out' and 'state' are deliberately outside it: closing a visit you are
  // already inside of is not entry, and a plan change mid-session must not trap
  // a member in the building — the same reasoning generateCodeCore applies to a
  // member with an open visit but a lapsed membership.
  if ((action === 'in' || action === 'code') && !gymCanUse(gym, 'qr_checkin')) {
    return planLocked(gym.name, 'app check-in');
  }

  try {
    if (action === 'in') {
      const res = await checkInCore(supabase, user.id, gym);
      return res.ok
        ? json({ ok: true, checked_in: true, days_left: res.daysLeft })
        : json({ ok: false, error: res.error }, 422);
    }

    if (action === 'out') {
      const res = await checkOutCore(supabase, user.id, gym.id);
      return res.ok
        ? json({ ok: true, checked_in: false })
        : json({ ok: false, error: res.error }, 422);
    }

    if (action === 'code') {
      const res = await generateCodeCore(supabase, user.id, gym);
      return res.ok
        ? json({ ok: true, code: res.code, expires_at: res.expiresAt })
        : json({ ok: false, error: res.error }, 422);
    }

    if (action === 'state') {
      const open = await openVisit(supabase, gym.id, user.id);
      return json({ ok: true, checked_in: Boolean(open) });
    }

    return json({ error: 'Unknown action.' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}
