import { dataUnavailable, requireApiMember, json, corsPreflight, readJson } from '@/lib/api-app';
import { requestOrigin } from '@/lib/request-origin';
import { startRenewalCore } from '@/lib/renew-core';
import { startAutoRenewalCore } from '@/lib/member-auto-renew-core';
import { rateLimit } from '@/lib/rate-limit';

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
  const autoRenew = body.auto_renew === true;
  if (!planId) return json({ error: 'Choose a plan.' }, 400);
  if (autoRenew && body.auto_renew_confirmed !== true) return json({ error: 'Confirm that you want automatic charges each period.' }, 400);

  try {
    if (!(await rateLimit(`renew:user:${user.id}`, 10, 60))) return json({ error: 'Too many checkout attempts. Please wait a moment.' }, 429);
    const origin = await requestOrigin();
    const callback = origin ? `${origin}/api/app/pay/callback` : undefined;
    const res = autoRenew ? await startAutoRenewalCore(user, gym, planId, withTrainer, callback) : await startRenewalCore(
      supabase, user, gym, planId, withTrainer,
      callback,
    );
    return res.ok
      ? json({ ok: true, authorization_url: res.url, reference: res.reference ?? null })
      : json({ ok: false, error: res.error }, 422);
  } catch {
    return dataUnavailable();
  }
}
