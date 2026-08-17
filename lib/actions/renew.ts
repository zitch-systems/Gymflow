'use server';

import { requireMember } from '@/lib/auth/dal';
import { requestOrigin } from '@/lib/request-origin';
import { createClient } from '@/lib/supabase/server';
import { startRenewalCore, type RenewResult } from '@/lib/renew-core';

// No `export type { RenewResult }` here, however tempting. A 'use server' file
// may only export async functions, and Turbopack's server-actions transform
// re-emitted this type-only re-export as a real one — so the compiled module
// evaluated `export { RenewResult }` against a binding that types had erased,
// and every /dashboard/renew request died with `RenewResult is not defined`
// before the page could render. Import the type from '@/lib/renew-core'.

// Start a Paystack checkout for a renewal from the web PWA. The pricing and
// validation live in lib/renew-core.ts, shared with the Android app's
// /api/app/renew; what differs is the callback, and that is this file's job.
export async function startRenewal(planId: string, withTrainer = false): Promise<RenewResult> {
  const { user, gym } = await requireMember();
  const supabase = await createClient();

  // The host the member is ON, not the apex: sessions are host-scoped, so a
  // callback to gymflow.ng from a member browsing <gym>.gymflow.ng arrives
  // signed out and bounces them to the login page after they've paid.
  const site = await requestOrigin();
  return startRenewalCore(
    supabase, user, gym, planId, withTrainer,
    site ? `${site}/dashboard/renew/callback` : undefined,
  );
}
