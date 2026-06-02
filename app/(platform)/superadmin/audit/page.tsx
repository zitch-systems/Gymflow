import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isPlatformAdmin, requireAuth } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { fmtDateTime } from '@/lib/format';
import { actionLabel, renderAuditDelta } from '@/lib/audit-render';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { ButtonLink } from '@/components/ui/button';
import { ArrowLeft, ShieldCheck, Filter } from 'lucide-react';

type PageProps = {
  searchParams: Promise<{ gym?: string; scope?: string; days?: string }>;
};

const SCOPES = [
  { id: 'all',      label: 'All events',         prefix: null },
  { id: 'lifecycle', label: 'Gym lifecycle',     prefix: 'platform.gym_' },
  { id: 'admin',    label: 'Gym admin actions',  prefix: 'admin.' },
  { id: 'member',   label: 'Member-initiated',   prefix: 'member.' },
] as const;

const DAY_OPTIONS = [
  { id: '7',  label: 'Last 7 days',  days: 7 },
  { id: '30', label: 'Last 30 days', days: 30 },
  { id: '90', label: 'Last 90 days', days: 90 },
] as const;

const DAY_MS = 86_400_000;

export default async function SuperadminAuditPage({ searchParams }: PageProps) {
  await requireAuth();
  if (!(await isPlatformAdmin())) redirect('/');

  const sp = await searchParams;
  const scopeId = sp.scope && SCOPES.some((s) => s.id === sp.scope) ? sp.scope : 'all';
  const scope = SCOPES.find((s) => s.id === scopeId) ?? SCOPES[0];
  const daysId = sp.days && DAY_OPTIONS.some((d) => d.id === sp.days) ? sp.days : '30';
  const days = DAY_OPTIONS.find((d) => d.id === daysId) ?? DAY_OPTIONS[1];
  const gymFilter = sp.gym ?? '';

  // Server component running per request — current time is legitimately
  // request-scoped state, not a purity violation.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const since = new Date(now - days.days * DAY_MS).toISOString();

  // Use admin client — audit_logs.SELECT for platform_admin already works
  // via RLS, but we also want to join profiles + gyms without round-tripping
  // through user-scoped policies on every related table.
  const supabase = createAdminClient();

  let q = supabase
    .from('audit_logs')
    .select('id, created_at, action, table_name, record_id, gym_id, actor_id, old_values, new_values, gyms:gym_id(slug, name)')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(300);
  if (scope.prefix) q = q.ilike('action', `${scope.prefix}%`);
  if (gymFilter) q = q.eq('gym_id', gymFilter);
  const { data: rows } = await q;

  // Batched actor lookup — one .in() against profiles, no N+1.
  const actorIds = Array.from(new Set((rows ?? []).map((r) => r.actor_id).filter((id): id is string => !!id)));
  const { data: actors } = actorIds.length
    ? await supabase.from('profiles').select('id, full_name, first_name, email').in('id', actorIds)
    : { data: [] };
  const actorById = new Map((actors ?? []).map((a) => [a.id, a]));

  // For the gym filter dropdown we want ALL gyms, not just ones in the
  // current view, so the user can switch into a gym they don't see yet.
  const { data: allGyms } = await supabase
    .from('gyms')
    .select('id, slug, name')
    .order('name', { ascending: true })
    .limit(500);

  const baseHref = (overrides: Partial<{ scope: string; days: string; gym: string }>) => {
    const params = new URLSearchParams();
    const merged = { scope: scopeId, days: daysId, gym: gymFilter, ...overrides };
    if (merged.scope && merged.scope !== 'all') params.set('scope', merged.scope);
    if (merged.days && merged.days !== '30') params.set('days', merged.days);
    if (merged.gym) params.set('gym', merged.gym);
    const qs = params.toString();
    return qs ? `/superadmin/audit?${qs}` : '/superadmin/audit';
  };

  return (
    <div className="gf-page">
      <PageHeader
        title="Platform audit log"
        subtitle={`${rows?.length ?? 0} event${(rows?.length ?? 0) === 1 ? '' : 's'} across every gym · ${days.label.toLowerCase()}`}
        actions={
          <ButtonLink href="/superadmin" variant="ghost" size="sm" leadingIcon={<ArrowLeft size={16} strokeWidth={1.75} />}>
            Back
          </ButtonLink>
        }
      />

      <Card>
        <div style={{ padding: 12, borderBottom: '1px solid var(--gf-border)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Filter size={14} strokeWidth={2} style={{ color: 'var(--gf-text-muted)' }} aria-hidden />
          <span style={{ fontSize: 12, color: 'var(--gf-text-muted)', marginRight: 4 }}>Filter</span>
          {SCOPES.map((s) => (
            <Link key={s.id} href={baseHref({ scope: s.id })} className={`gf-chip${s.id === scopeId ? ' active' : ''}`}>
              {s.label}
            </Link>
          ))}
          <span style={{ width: 1, height: 18, background: 'var(--gf-border)', margin: '0 4px' }} aria-hidden />
          <form
            action="/superadmin/audit"
            method="get"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <input type="hidden" name="scope" value={scopeId} />
            <input type="hidden" name="days" value={daysId} />
            <label htmlFor="gym-select" style={{ fontSize: 12, color: 'var(--gf-text-muted)' }}>Gym</label>
            <select
              id="gym-select"
              name="gym"
              defaultValue={gymFilter}
              className="gf-select"
              style={{ height: 28, padding: '0 8px', fontSize: 12, minWidth: 160 }}
            >
              <option value="">All gyms</option>
              {(allGyms ?? []).map((g) => (
                <option key={g.id} value={g.id}>{g.name ?? g.slug}</option>
              ))}
            </select>
            <button type="submit" className="gf-chip" style={{ borderColor: 'var(--gf-brand)', color: 'var(--gf-brand)' }}>
              Apply
            </button>
            {gymFilter ? (
              <Link href={baseHref({ gym: '' })} className="gf-chip" style={{ fontSize: 11 }}>Clear</Link>
            ) : null}
          </form>
          <span style={{ flex: 1 }} />
          {DAY_OPTIONS.map((d) => (
            <Link key={d.id} href={baseHref({ days: d.id })} className={`gf-chip${d.id === daysId ? ' active' : ''}`}>
              {d.label}
            </Link>
          ))}
        </div>

        {rows && rows.length > 0 ? (
          <div className="gf-table-wrap">
            <table role="table" className="gf-table gf-table-cards">
              <thead>
                <tr role="row">
                  <th style={{ whiteSpace: 'nowrap' }}>When</th>
                  <th>Gym</th>
                  <th>Who</th>
                  <th>What</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {rows.map((r) => {
                  const gym = Array.isArray(r.gyms) ? r.gyms[0] : r.gyms;
                  const actor = r.actor_id ? actorById.get(r.actor_id) : null;
                  const actorName = actor?.full_name ?? actor?.first_name ?? actor?.email ?? 'System';
                  const delta = renderAuditDelta(r.old_values, r.new_values);
                  return (
                    <tr role="row" key={r.id}>
                      <td role="cell" style={{ whiteSpace: 'nowrap', fontSize: 12, color: 'var(--gf-text-secondary)' }}>{fmtDateTime(r.created_at)}</td>
                      <td role="cell" style={{ whiteSpace: 'nowrap' }} data-label="Gym">
                        {gym ? (
                          <Link href={baseHref({ gym: r.gym_id ?? '' })} style={{ color: 'var(--gf-text)' }}>
                            {gym.name ?? gym.slug}
                          </Link>
                        ) : '—'}
                      </td>
                      <td role="cell" style={{ whiteSpace: 'nowrap' }} data-label="Who">{actorName}</td>
                      <td role="cell" style={{ whiteSpace: 'nowrap' }} data-label="What">
                        <span style={{ fontWeight: 600 }}>{actionLabel(r.action)}</span>
                        {r.record_id ? (
                          <span style={{ fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 11, color: 'var(--gf-text-muted)', marginLeft: 6 }}>
                            {r.record_id.slice(0, 8)}
                          </span>
                        ) : null}
                      </td>
                      <td role="cell" style={{ maxWidth: 440 }}>
                        {delta.rows.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
                            {delta.rows.slice(0, 4).map(({ key, from, to }) => (
                              <div key={key} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                <span style={{ color: 'var(--gf-text-muted)', minWidth: 100 }}>{key}</span>
                                {from ? (
                                  <>
                                    <span style={{ color: 'var(--gf-danger)', textDecoration: 'line-through' }}>{from}</span>
                                    <span style={{ color: 'var(--gf-text-muted)' }}>→</span>
                                    <span style={{ color: 'var(--gf-brand)' }}>{to}</span>
                                  </>
                                ) : (
                                  <span>{to}</span>
                                )}
                              </div>
                            ))}
                            {delta.rows.length > 4 ? (
                              <span style={{ color: 'var(--gf-text-muted)', fontSize: 11 }}>+{delta.rows.length - 4} more</span>
                            ) : null}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--gf-text-muted)', fontSize: 12 }}>{delta.raw ?? '—'}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={ShieldCheck}
            title={gymFilter || scope.id !== 'all' ? 'No events match these filters' : 'No events in this window'}
            message="Gym lifecycle changes (suspend / terminate / re-activate), per-gym admin actions, and member-initiated events all appear here. Try widening the window or clearing the scope/gym filter."
          />
        )}
      </Card>
    </div>
  );
}
