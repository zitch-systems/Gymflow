import { requireApiMember, json, corsPreflight, readJson } from '@/lib/api-app';
import { requestOrigin } from '@/lib/request-origin';
import { startRenewalCore } from '@/lib/renew-core';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export function OPTIONS() {
  return corsPreflight();
}

// POST /api/app/renew — { plan_id, with_trainer? } → a Paystack checkout URL.
//
// The app opens that URL in a system browser tab, not a WebView it controls:
// card entry belongs to Paystack's page in a browser the member's password
// manager and bank app can both reach.
//
// Paystack sends them back to /api/app/pay/callback — a public route that
// verifies and fulfils, then bounces to the app's deep link. The web callback
// page can't serve here: it is cookie-authenticated, and the browser tab has
// none of the app's session.
export async function POST(req: Request) {
  const auth = await requireApiMember(req);
  if (!auth.ok) return auth.res;
  const { supabase, user, gym } = auth.ctx;

  const body = await readJson(req);
  const planId = String(body.plan_id ?? '').trim();
  const withTrainer = body.with_trainer === true;
  if (!planId) return json({ error: 'Choose a plan.' }, 400);

  try {
    const origin = await requestOrigin();
    const res = await startRenewalCore(
      supabase, user, gym, planId, withTrainer,
      origin ? `${origin}/api/app/pay/callback` : undefined,
    );
    return res.ok
      ? json({ ok: true, authorization_url: res.url, reference: res.reference ?? null })
      : json({ ok: false, error: res.error }, 422);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}
