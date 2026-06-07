import { ScrollText, Search } from 'lucide-react';
import { requirePlatformAdmin } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime } from '@/lib/format';

export const metadata = { title: 'Audit log' };

export default async function SuperAudit() {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { data: logs } = await supabase
    .from('audit_logs')
    .select('id, action, table_name, actor_id, created_at, record_id')
    .order('created_at', { ascending: false })
    .limit(40);

  return (
    <>
      <div className="hdr"><div><span className="pill-plat">Operations</span><h1>Audit log</h1><p>Every privileged action across the platform</p></div></div>
      <div className="panel">
        <div className="toolbar"><div className="search"><Search strokeWidth={1.75} /><input placeholder="Filter by table, actor or action…" aria-label="Search audit log" /></div><div style={{ flex: 1 }} /><span className="gf-chip active">All</span></div>
        {(logs ?? []).length === 0 ? (
          <div className="empty"><div className="eic"><ScrollText strokeWidth={1.6} /></div><h3>No audit entries yet</h3><p>Privileged actions across all gyms are recorded here.</p></div>
        ) : (logs ?? []).map((l) => (
          <div className="act-row" key={l.id}>
            <div className="ic" style={{ background: 'var(--gf-elevated)', color: 'var(--gf-text-secondary)' }}><ScrollText strokeWidth={1.9} /></div>
            <div className="m"><strong style={{ textTransform: 'capitalize' }}>{(l.action ?? 'action').replace(/_/g, ' ')} · {l.table_name}</strong><small>{l.record_id ? `record ${l.record_id.slice(0, 8)}` : ''}{l.actor_id ? ` · actor ${l.actor_id.slice(0, 8)}` : ''}</small></div>
            <span className="t">{fmtDateTime(l.created_at)}</span>
          </div>
        ))}
      </div>
    </>
  );
}
