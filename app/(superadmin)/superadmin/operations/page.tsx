import { Activity, AlertTriangle, DatabaseBackup, RefreshCw } from 'lucide-react';
import { requirePlatformAdmin } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { fmtDateTime } from '@/lib/format';
import { requeuePaymentWebhook } from '@/lib/actions/operations';

export const metadata = { title: 'Job health' };
export const dynamic = 'force-dynamic';

type Job = {
  job_name: string; last_heartbeat_at: string | null; last_succeeded_at: string | null;
  last_error: string | null; consecutive_failures: number; watermark: string | null;
};
type Incident = {
  id: string; kind: string; reference: string | null; error: string; attempts: number; last_seen_at: string;
};
type QueueItem = {
  body_hash: string; event_name: string; reference: string | null; status: string;
  attempts: number; last_error: string | null; next_attempt_at: string;
};

function when(value: string | null | undefined): string {
  return value ? fmtDateTime(value) : 'Never';
}

export default async function OperationsPage() {
  await requirePlatformAdmin();
  const admin = createAdminClient();
  const [jobsRes, incidentsRes, webhookRes, backupRes] = await Promise.all([
    admin.from('operational_job_state' as never)
      .select('job_name, last_heartbeat_at, last_succeeded_at, last_error, consecutive_failures, watermark')
      .order('job_name'),
    admin.from('operational_incidents' as never)
      .select('id, kind, reference, error, attempts, last_seen_at')
      .is('resolved_at', null).order('last_seen_at', { ascending: false }).limit(50),
    admin.from('payment_webhook_jobs' as never)
      .select('body_hash, event_name, reference, status, attempts, last_error, next_attempt_at')
      .in('status', ['retry', 'dead', 'processing']).order('next_attempt_at').limit(50),
    admin.from('gym_backup_jobs' as never)
      .select('gym_id, due_at, status, attempts, last_error, next_attempt_at')
      .order('due_at').limit(50),
  ]);
  const jobs = (jobsRes.data ?? []) as unknown as Job[];
  const incidents = (incidentsRes.data ?? []) as unknown as Incident[];
  const webhook = (webhookRes.data ?? []) as unknown as QueueItem[];
  const backups = (backupRes.data ?? []) as unknown as Array<{
    gym_id: string; due_at: string; status: string; attempts: number; last_error: string | null; next_attempt_at: string;
  }>;

  return (
    <>
      <div className="hdr"><div><span className="pill-plat">Operations</span><h1>Job health</h1><p>Durable queues, checkpoints, and handled failures</p></div></div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-h"><div><h3>Scheduled jobs</h3><div className="sub">A missed success stays visible after logs expire</div></div><Activity size={18} /></div>
          {jobs.map((job) => (
            <div className="act-row" key={job.job_name}>
              <div className="ic"><RefreshCw strokeWidth={1.8} /></div>
              <div className="m"><strong>{job.job_name.replace(/_/g, ' ')}</strong><small>Last success {when(job.last_succeeded_at)}{job.watermark ? ` · through ${when(job.watermark)}` : ''}</small>{job.last_error && <small style={{ color: 'var(--gf-danger)' }}>{job.last_error}</small>}</div>
              <span className="t">{job.consecutive_failures ? `${job.consecutive_failures} failed` : 'Healthy'}</span>
            </div>
          ))}
        </div>

        <div className="panel">
          <div className="panel-h"><div><h3>Backup queue</h3><div className="sub">Oldest due first; failed work backs off and retries</div></div><DatabaseBackup size={18} /></div>
          {backups.length === 0 ? <div className="empty sm"><h3>Queue drained</h3><p>No gym backup is waiting.</p></div> : backups.map((job) => (
            <div className="act-row" key={job.gym_id}>
              <div className="m"><strong>Gym {job.gym_id.slice(0, 8)}</strong><small>Due {when(job.due_at)} · {job.status} · attempt {job.attempts}</small>{job.last_error && <small style={{ color: 'var(--gf-danger)' }}>{job.last_error}</small>}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-h"><div><h3>Payment recovery queue</h3><div className="sub">Provider payloads stay restricted and are never rendered here</div></div><RefreshCw size={18} /></div>
        {webhook.length === 0 ? <div className="empty sm"><h3>No stuck payment events</h3><p>Retry and repair work is clear.</p></div> : webhook.map((job) => (
          <div className="act-row" key={job.body_hash}>
            <div className="m"><strong>{job.event_name} · {job.reference ?? 'no reference'}</strong><small>{job.status} · attempt {job.attempts} · next {when(job.next_attempt_at)}</small>{job.last_error && <small style={{ color: 'var(--gf-danger)' }}>{job.last_error}</small>}</div>
            {job.status === 'dead' && <form action={requeuePaymentWebhook}><input type="hidden" name="body_hash" value={job.body_hash} /><button className="gf-btn gf-btn-secondary gf-btn-sm" type="submit">Verify &amp; retry</button></form>}
          </div>
        ))}
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-h"><div><h3>Open incidents</h3><div className="sub">Repeated handled errors collapse into one incident with an attempt count</div></div><AlertTriangle size={18} /></div>
        {incidents.length === 0 ? <div className="empty sm"><h3>No open incidents</h3><p>Handled operational errors will appear here.</p></div> : incidents.map((incident) => (
          <div className="act-row" key={incident.id}>
            <div className="m"><strong>{incident.kind}</strong><small>{incident.reference ? `${incident.reference} · ` : ''}{incident.error}</small></div>
            <span className="t">{incident.attempts}× · {when(incident.last_seen_at)}</span>
          </div>
        ))}
      </div>
    </>
  );
}
