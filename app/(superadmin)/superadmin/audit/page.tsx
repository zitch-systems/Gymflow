import { ScrollText, Search } from 'lucide-react';
import { requirePlatformAdmin } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime } from '@/lib/format';
import { Pagination } from '@/components/pagination';

export const metadata = { title: 'Audit log' };

const PAGE_SIZE = 50;

export default async function SuperAudit({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();

  // Server-side search (over the text columns) + true pagination, so the log
  // no longer silently stops at a 200-row cap. Sanitize q for the PostgREST
  // or()-filter grammar (strip its delimiters) before interpolating.
  let query = supabase
    .from('audit_logs')
    .select('id, action, table_name, actor_id, created_at, record_id', { count: 'exact' });
  if (q) {
    const safe = q.replace(/[%,()*\\]/g, ' ').trim();
    if (safe) query = query.or(`action.ilike.%${safe}%,table_name.ilike.%${safe}%`);
  }
  const from = (page - 1) * PAGE_SIZE;
  const { data: logs, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  const total = count ?? 0;

  return (
    <>
      <div className="hdr"><div><span className="pill-plat">Operations</span><h1>Audit log</h1><p>Every privileged action across the platform</p></div></div>
      <div className="panel">
        <div className="toolbar"><form className="search" action="/superadmin/audit" style={{ display: 'flex' }}><Search strokeWidth={1.75} /><input name="q" defaultValue={q} placeholder="Filter by table or action…" aria-label="Search audit log" /></form><div style={{ flex: 1 }} /></div>
        {(logs ?? []).length === 0 ? (
          q
            ? <div className="empty"><div className="eic"><ScrollText strokeWidth={1.6} /></div><h3>No matching entries</h3><p>Try a different table or action.</p></div>
            : <div className="empty"><div className="eic"><ScrollText strokeWidth={1.6} /></div><h3>No audit entries yet</h3><p>Privileged actions across all gyms are recorded here.</p></div>
        ) : (
          <>
            {(logs ?? []).map((l) => (
              <div className="act-row" key={l.id}>
                <div className="ic" style={{ background: 'var(--gf-elevated)', color: 'var(--gf-text-secondary)' }}><ScrollText strokeWidth={1.9} /></div>
                <div className="m"><strong style={{ textTransform: 'capitalize' }}>{(l.action ?? 'action').replace(/_/g, ' ')} · {l.table_name}</strong><small>{l.record_id ? `record ${l.record_id.slice(0, 8)}` : ''}{l.actor_id ? ` · actor ${l.actor_id.slice(0, 8)}` : ''}</small></div>
                <span className="t">{fmtDateTime(l.created_at)}</span>
              </div>
            ))}
            <Pagination basePath="/superadmin/audit" params={{ q: q || undefined }} page={page} pageSize={PAGE_SIZE} total={total} />
          </>
        )}
      </div>
    </>
  );
}
