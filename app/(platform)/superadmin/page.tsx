import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getProfile, requireAuth } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { fmtDate, fmtNaira } from '@/lib/format';
import { signOut } from '@/lib/auth/actions';
import { SuperadminGymRowActions } from './gym-row-actions';

export default async function SuperadminPage() {
  await requireAuth();
  const profile = await getProfile();
  if (profile?.role !== 'platform_admin') redirect('/');

  // Platform admin views aggregate data across all gyms — use service-role
  // client so RLS on gym-scoped tables doesn't filter rows out.
  const admin = createAdminClient();
  const now = Date.now();
  const since30 = new Date(now - 30 * 86_400_000).toISOString();
  const since35 = new Date(now - 35 * 86_400_000).toISOString();

  const [
    { data: gyms },
    { count: gymCount },
    { count: activeGymCount },
    { count: profileCount },
    { data: platformPayments30 },
    { data: recentChurn },
    { data: paidGymIds },
  ] = await Promise.all([
    admin
      .from('gyms')
      .select('id, name, slug, subscription_status, subscription_plan, created_at, trial_ends_at, email')
      .order('created_at', { ascending: false })
      .limit(100),
    admin.from('gyms').select('*', { count: 'exact', head: true }),
    admin.from('gyms').select('*', { count: 'exact', head: true }).eq('subscription_status', 'active'),
    admin.from('profiles').select('*', { count: 'exact', head: true }),
    admin
      .from('platform_payments')
      .select('amount, created_at')
      .eq('payment_status', 'successful')
      .gte('created_at', since30),
    admin
      .from('gyms')
      .select('id', { count: 'exact' })
      .in('subscription_status', ['suspended', 'terminated', 'cancelled'])
      .gte('updated_at', since30),
    admin
      .from('platform_payments')
      .select('gym_id')
      .eq('payment_status', 'successful')
      .gte('created_at', since35),
  ]);

  const mrr30 = (platformPayments30 ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const churned = recentChurn?.length ?? 0;
  const totalGyms = gymCount ?? 0;
  const churnPct = totalGyms > 0 ? Math.round((churned / totalGyms) * 1000) / 10 : 0;

  const paidIds = new Set((paidGymIds ?? []).map((r) => r.gym_id));
  const overdue = (gyms ?? []).filter((g) => g.subscription_status === 'active' && !paidIds.has(g.id)).length;

  return (
    <div className="gf-page">
      <header className="gf-page-header">
        <div>
          <h1 className="gf-page-title">Platform admin</h1>
          <p className="gf-page-subtitle">All gyms across GymFlow</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href="/superadmin/members" className="gf-btn gf-btn-ghost gf-btn-sm">
            Find member
          </Link>
          <Link href="/superadmin/audit" className="gf-btn gf-btn-ghost gf-btn-sm">
            Audit log
          </Link>
          <Link href="/superadmin/gyms/new" className="gf-btn gf-btn-primary gf-btn-sm">
            + Onboard gym
          </Link>
          <form action={signOut}>
            <button type="submit" className="gf-btn gf-btn-ghost gf-btn-sm">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className="gf-kpi-grid">
        <Kpi label="Total gyms" value={String(totalGyms)} accent="emerald" />
        <Kpi label="Active gyms" value={String(activeGymCount ?? 0)} accent="blue" />
        <Kpi label="MRR (30d platform fees)" value={fmtNaira(mrr30)} accent="purple" />
        <Kpi label="Churn 30d" value={`${churnPct}%`} accent="amber" />
        <Kpi label="Overdue (no payment 35d)" value={String(overdue)} accent="amber" />
        <Kpi label="Total profiles" value={String(profileCount ?? 0)} accent="blue" />
      </section>

      <section className="gf-card">
        <header className="gf-card-header">
          <h2 className="gf-card-title">Gyms</h2>
        </header>
        <div className="gf-table-wrap">
          <table className="gf-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Slug</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Trial ends</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(gyms ?? []).map((g) => (
                <tr key={g.id}>
                  <td>
                    <a href={`https://${g.slug}.gymflow.ng/admin/dashboard`} className="gf-link" target="_blank" rel="noreferrer">
                      {g.name}
                    </a>
                    <div className="gf-table-meta">{g.email ?? '—'}</div>
                  </td>
                  <td className="gf-table-meta">{g.slug}</td>
                  <td>{g.subscription_plan ?? '—'}</td>
                  <td>
                    <span className={`status-pill ${g.subscription_status === 'active' ? 'on' : 'off'}`}>
                      {g.subscription_status ?? '—'}
                    </span>
                  </td>
                  <td>{g.trial_ends_at ? fmtDate(g.trial_ends_at) : '—'}</td>
                  <td>{fmtDate(g.created_at)}</td>
                  <td>
                    <SuperadminGymRowActions
                      gymId={g.id}
                      slug={g.slug}
                      ownerEmail={g.email ?? ''}
                      status={g.subscription_status ?? 'unknown'}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent: 'emerald' | 'blue' | 'amber' | 'purple' }) {
  return (
    <div className={`gf-kpi gf-kpi-${accent}`}>
      <div className="gf-kpi-value">{value}</div>
      <div className="gf-kpi-label">{label}</div>
    </div>
  );
}
