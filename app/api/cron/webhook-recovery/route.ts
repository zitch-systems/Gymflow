import { cronAuthorized } from '@/lib/cron-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { claimPaystackEvents, processClaimedPaystackEvent } from '@/lib/webhook-recovery';
import { markJobFailed, markJobStarted, markJobSucceeded } from '@/lib/operational-jobs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BATCH_SIZE = 20;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response('Unauthorized', { status: 401 });

  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); }
  catch { return Response.json({ ok: false, error: 'service role unavailable' }, { status: 503 }); }

  try {
    await markJobStarted(admin, 'payment_webhook_recovery');
    const { jobs } = await claimPaystackEvents(admin, BATCH_SIZE);
    let completed = 0;
    let dead = 0;
    let retry = 0;
    for (const job of jobs) {
      const result = await processClaimedPaystackEvent(admin, job);
      if (result.outcome === 'permanent_failure') dead++;
      else if (result.outcome === 'retry') retry++;
      else completed++;
    }

    // Completed rows contain encrypted provider bodies. Keep a finite support
    // window, then erase in bounded batches; dead rows remain until repaired.
    const staleBefore = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { data: stale, error: staleError } = await admin.from('payment_webhook_jobs' as never)
      .select('body_hash').eq('status', 'completed').lt('completed_at', staleBefore)
      .order('completed_at', { ascending: true }).limit(1000);
    if (staleError) throw new Error('could not inspect completed payment recovery retention');
    const staleHashes = (stale ?? []).map((row) => (row as { body_hash: string }).body_hash);
    if (staleHashes.length) {
      const { error: deleteError } = await admin.from('payment_webhook_jobs' as never).delete().in('body_hash', staleHashes);
      if (deleteError) throw new Error('could not apply payment recovery retention');
    }

    if (retry > 0 || dead > 0) {
      const error = `${retry} Paystack event${retry === 1 ? '' : 's'} remain retryable; ${dead} require operator repair`;
      await markJobFailed(admin, 'payment_webhook_recovery', error);
      return Response.json({ ok: false, claimed: jobs.length, completed, dead, retry }, { status: 500 });
    }
    await markJobSucceeded(admin, 'payment_webhook_recovery');
    return Response.json({ ok: true, claimed: jobs.length, completed, dead, retry, pruned: staleHashes.length });
  } catch (e) {
    await markJobFailed(admin, 'payment_webhook_recovery', e).catch(() => undefined);
    return Response.json({ ok: false, error: 'webhook recovery worker failed' }, { status: 500 });
  }
}
