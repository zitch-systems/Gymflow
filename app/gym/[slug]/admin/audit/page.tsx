import Link from 'next/link';
import { requireManager } from '@/lib/auth/gym';
import { createAdminClient } from '@/lib/supabase/admin';
import { fmtDateTime } from '@/lib/format';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { ShieldCheck, Filter } from 'lucide-react';

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ scope?: string; days?: string }>;
};

// Human-readable label for each action string we emit. Falls back to a
// title-cased version of the raw action so newly-added actions still render
// without breaking the page.
const ACTION_LABEL: Record<string, string> = {
  'admin.member_onboarded': 'Onboarded member',
  'admin.pause_approved': 'Approved pause',
  'admin.resume': 'Resumed membership',
  'admin.extend_membership': 'Extended membership',
  'admin.cancel_membership': 'Cancelled membership',
  'admin.instructor_invited': 'Invited instructor',
  'admin.subaccount_created': 'Connected Paystack subaccount',
  'admin.subaccount_updated': 'Updated Paystack subaccount',
  'admin.plan_created': 'Created plan',
  'admin.plan_updated': 'Updated plan',
  'admin.plan_deleted': 'Deleted plan',
  'admin.equipment_created': 'Added equipment',
  'admin.equipment_updated': 'Updated equipment',
  'admin.equipment_deleted': 'Removed equipment',
  'admin.expense_created': 'Logged expense',
  'admin.expense_updated': 'Updated expense',
  'admin.expense_deleted': 'Deleted expense',
  'admin.class_created': 'Created class',
  'admin.class_deleted': 'Deleted class',
  'admin.business_hours_updated': 'Updated business hours',
  'admin.gym_active': 'Re-activated gym',
  'admin.gym_suspended': 'Suspended gym',
  'admin.gym_terminated': 'Terminated gym',
  'member.pause_requested': 'Requested pause',
  'member.cancel_at_period_end': 'Cancelled at period end',
};

const SCOPES = [
  { id: 'all',         label: 'All events',           prefix: null },
  { id: 'plans',       label: 'Plans',                prefix: 'admin.plan_' },
  { id: 'members',     label: 'Members',              prefix: 'admin.member_' },
  { id: 'instructors', label: 'Instructors',          prefix: 'admin.instructor_' },
  { id: 'classes',     label: 'Classes',              prefix: 'admin.class_' },
  { id: 'equipment',   label: 'Equipment',            prefix: 'admin.equipment_' },
  { id: 'expenses',    label: 'Expenses',             prefix: 'admin.expense_' },
  { id: 'billing',     label: 'Billing',              prefix: 'admin.subaccount_' },
] as const;

const DAY_OPTIONS = [
  { id: '7',  label: 'Last 7 days',  days: 7 },
  { id: '30', label: 'Last 30 days', days: 30 },
  { id: '90', label: 'Last 90 days', days: 90 },
] as const;

const DAY_MS = 86_400_000;

function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'string') return v.length > 40 ? v.slice(0, 37) + '…' : v;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// Compact before → after delta for updates. For inserts and deletes only one
// side is populated, so we just show the relevant set.
function renderDelta(before: unknown, after: unknown): {
  rows: Array<{ key: string; from: string; to: string }>;
  raw: string | null;
} {
  if (typeof before === 'object' && before !== null && typeof after === 'object' && after !== null) {
    const b = before as Record<string, unknown>;
    const a = after as Record<string, unknown>;
    const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)]));
    const changed = keys
      .filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
      .map((k) => ({ key: k, from: fmt(b[k]), to: fmt(a[k]) }));
    return { rows: changed, raw: null };
  }
  const side = after ?? before;
  if (typeof side === 'object' && side !== null) {
    const s = side as Record<string, unknown>;
    return {
      rows: Object.entries(s).map(([k, v]) => ({ key: k, from: '', to: fmt(v) })),
      raw: null,
    };
  }
  return { rows: [], raw: side != null ? JSON.stringify(side) : null };
}

export default async function AdminAuditPage({ params, searchParams }: PageProps) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  // Audit log is owner/manager only — front-desk and accountant don't need
  // to see team activity records, and the underlying RLS policy on
  // audit_logs is also owner-scoped.
  const { gym } = await requireManager(slug);

  const scopeId = sp.scope && SCOPES.some((s) => s.id === sp.scope) ? sp.scope : 'all';
  const scope = SCOPES.find((s) => s.id === scopeId) ?? SCOPES[0];
  const daysId = sp.days && DAY_OPTIONS.some((d) => d.id === sp.days) ? sp.days : '30';
  const days = DAY_OPTIONS.find((d) => d.id === daysId) ?? DAY_OPTIONS[1];

  // Read via admin client — the audit_logs SELECT policy is restricted to
  // gym_owner and platform_admin, so managers would see empty rows under
  // RLS. We've already validated requireManager() above.
  const supabase = createAdminClient();
  // Server component running per request — current time is legitimately
  // request-scoped state, not a purity violation. (Same disable as the admin
  // layout's renewal-countdown computation.)
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const since = new Date(now - days.days * DAY_MS).toISOString();

  let q = supabase
    .from('audit_logs')
    .select('id, created_at, action, table_name, record_id, actor_id, user_id, old_values, new_values, ip_address')
    .eq('gym_id', gym.id)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(200);
  if (scope.prefix) q = q.ilike('action', `${scope.prefix}%`);
  const { data: rows } = await q;

  // Batch-look-up actor names so the page shows "by Tunde A." instead of a
  // bare uuid. Single query keyed on the distinct actor_ids in this page.
  const actorIds = Array.from(new Set((rows ?? []).map((r) => r.actor_id).filter((id): id is string => !!id)));
  const { data: actors } = actorIds.length
    ? await supabase.from('profiles').select('id, full_name, first_name, email').in('id', actorIds)
    : { data: [] };
  const actorById = new Map((actors ?? []).map((a) => [a.id, a]));

  return (
    <div className="gf-page">
      <PageHeader
        title="Audit log"
        subtitle={`${rows?.length ?? 0} event${(rows?.length ?? 0) === 1 ? '' : 's'} at ${gym.name} · ${days.label.toLowerCase()}`}
      />

      <Card>
        <div style={{ padding: 12, borderBottom: '1px solid var(--gf-border)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Filter size={14} strokeWidth={2} style={{ color: 'var(--gf-text-muted)' }} aria-hidden />
          <span style={{ fontSize: 12, color: 'var(--gf-text-muted)', marginRight: 4 }}>Filter</span>
          {SCOPES.map((s) => (
            <Link
              key={s.id}
              href={`/admin/audit?scope=${s.id}&days=${daysId}`}
              className={`gf-chip${s.id === scopeId ? ' active' : ''}`}
            >
              {s.label}
            </Link>
          ))}
          <span style={{ flex: 1 }} />
          {DAY_OPTIONS.map((d) => (
            <Link
              key={d.id}
              href={`/admin/audit?scope=${scopeId}&days=${d.id}`}
              className={`gf-chip${d.id === daysId ? ' active' : ''}`}
            >
              {d.label}
            </Link>
          ))}
        </div>

        {rows && rows.length > 0 ? (
          <div className="gf-table-wrap">
            <table className="gf-table">
              <thead>
                <tr>
                  <th style={{ whiteSpace: 'nowrap' }}>When</th>
                  <th>Who</th>
                  <th>What</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const actor = r.actor_id ? actorById.get(r.actor_id) : null;
                  const actorName = actor?.full_name ?? actor?.first_name ?? actor?.email ?? 'System';
                  const delta = renderDelta(r.old_values, r.new_values);
                  return (
                    <tr key={r.id}>
                      <td style={{ whiteSpace: 'nowrap', fontSize: 12, color: 'var(--gf-text-secondary)' }}>{fmtDateTime(r.created_at)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{actorName}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <span style={{ fontWeight: 600 }}>{actionLabel(r.action)}</span>
                        {r.record_id ? (
                          <span style={{ fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 11, color: 'var(--gf-text-muted)', marginLeft: 6 }}>
                            {r.record_id.slice(0, 8)}
                          </span>
                        ) : null}
                      </td>
                      <td style={{ maxWidth: 480 }}>
                        {delta.rows.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
                            {delta.rows.slice(0, 5).map(({ key, from, to }) => (
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
                            {delta.rows.length > 5 ? (
                              <span style={{ color: 'var(--gf-text-muted)', fontSize: 11 }}>+{delta.rows.length - 5} more</span>
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
            title={scope.id === 'all' ? 'No events in this window' : `No ${scope.label.toLowerCase()} events`}
            message={
              <>
                Plan / pricing / class / equipment / expense / business-hours changes are recorded automatically,
                alongside member-management and billing actions. Try widening the window above.
              </>
            }
          />
        )}
      </Card>
    </div>
  );
}
