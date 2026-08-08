import { createHash, timingSafeEqual } from 'crypto';
import { adminOrNull } from '@/lib/email/recipients';
import { backupDue } from '@/lib/backup-plan';
import { runGymBackup } from '@/lib/backup-run';
import { isOfflineGym } from '@/lib/gym-status';

export const dynamic = 'force-dynamic';
// Backups read a gym's whole operating record and zip it. That is far heavier
// than the reminder fan-out in /api/cron, which is why this has its own route
// and its own schedule rather than sharing that route's budget.
export const maxDuration = 300;

// How many gyms one invocation will process. The rest are picked up on the next
// run — backupDue() compares against the last COMPLETED run, so a gym deferred
// today is still due tomorrow rather than skipped. Without this bound a growing
// tenant list would eventually time out mid-loop and back up nobody.
const MAX_PER_RUN = 20;

function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

// Same contract as /api/cron: CRON_SECRET as a Bearer token, no ?secret=
// fallback — query strings leak into access logs.
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get('authorization');
  return auth != null && safeEqual(auth, `Bearer ${secret}`);
}

/**
 * Run every gym whose backup schedule is due.
 *
 * Sequential, not parallel: each run holds a whole gym's data in memory while
 * zipping it, and several at once is how this route runs out of memory and
 * backs up nobody. Backups are not latency-sensitive.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 });

  const admin = adminOrNull();
  // No service-role key (preview deploys) — nothing to do, and 200 so the
  // scheduler doesn't retry a configuration state that won't change.
  if (!admin) return Response.json({ ok: true, skipped: 'no service role key' });

  const { data: gyms, error } = await admin
    .from('gyms')
    .select('id, name, backup_frequency, backup_email, backup_last_run_at, status')
    .neq('backup_frequency', 'off');
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  const now = new Date();
  const due = ((gyms ?? []) as {
    id: string; name: string | null; backup_frequency: string | null;
    backup_email: boolean | null; backup_last_run_at: string | null; status: string | null;
  }[])
    // A gym GymFlow has suspended keeps its data but stops being processed —
    // emailing an extract to an account we've taken offline is not our call to
    // make on their behalf.
    .filter((g) => !isOfflineGym(g))
    .filter((g) => backupDue(g.backup_frequency, g.backup_last_run_at, now));

  const batch = due.slice(0, MAX_PER_RUN);
  const results = [];
  for (const gym of batch) {
    results.push(await runGymBackup(gym.id, {
      trigger: 'scheduled',
      cadence: gym.backup_frequency ?? 'scheduled',
      email: gym.backup_email !== false,
    }));
  }

  const failed = results.filter((r) => !r.ok);
  return Response.json({
    ok: true,
    due: due.length,
    ran: results.length,
    // Named rather than counted: a silent partial failure is the thing this
    // whole feature exists to prevent.
    deferred: Math.max(0, due.length - batch.length),
    succeeded: results.filter((r) => r.ok).length,
    failed: failed.map((r) => ({ gym: r.gymId, error: r.error })),
    emailed: results.filter((r) => r.emailed).length,
  });
}
