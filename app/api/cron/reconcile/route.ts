import { cronAuthorized } from '@/lib/cron-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { runReconciliation } from '@/lib/reconcile';
import { markJobFailed, markJobStarted, markJobSucceeded } from '@/lib/operational-jobs';
import { redactOperationalText } from '@/lib/operational-core';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response('Unauthorized', { status: 401 });
  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); }
  catch { return Response.json({ ok: false, error: 'service role unavailable' }, { status: 503 }); }

  try {
    await markJobStarted(admin, 'paystack_reconciliation');
    const summary = await runReconciliation();
    if (!summary.ran || summary.error) {
      const error = summary.error ?? 'reconciliation did not run';
      await markJobFailed(admin, 'paystack_reconciliation', error);
      return Response.json({ ok: false, reconciliation: { ...summary, error: redactOperationalText(error) } }, { status: 500 });
    }
    await markJobSucceeded(admin, 'paystack_reconciliation');
    return Response.json({ ok: true, reconciliation: summary });
  } catch (e) {
    await markJobFailed(admin, 'paystack_reconciliation', e).catch(() => undefined);
    return Response.json({ ok: false, error: 'reconciliation worker failed' }, { status: 500 });
  }
}
