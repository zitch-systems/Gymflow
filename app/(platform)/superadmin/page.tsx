import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getProfile, requireAuth } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, fmtNaira } from '@/lib/format';
import { signOut } from '@/lib/auth/actions';
import { SuperadminGymRowActions } from './gym-row-actions';

export default async function SuperadminPage() {
  await requireAuth();
  const profile = await getProfile();
  if (profile?.role !== 'platform_admin') redirect('/');

  const supabase = await createClient();
  const [{ data: gyms }, { count: gymCount }, { count: profileCount }, { data: payments30 }] = await Promise.all([
    supabase
      .from('gyms')
      .select('id, name, slug, subscription_status, subscription_plan, created_at, trial_ends_at, email')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase.from('gyms').select('*', { count: 'exact', head: true }),
    supabase.from('profiles').select('*', { count: 'exact', head: true }),
    supabase
      .from('payments')
      .select('amount')
      .eq('payment_status', 'successful')
      .gte('payment_date', new Date(Date.now() - 30 * 86_400_000).toISOString()),
  ]);

  const revenue30 = (payments30 ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0);

  return (
    <div className="gf-page">
      <header className="gf-page-header">
        <div>
          <h1 className="gf-page-title">Platform admin</h1>
          <p className="gf-page-subtitle">All gyms across GymFlow</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
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
        <Kpi label="Total gyms" value={String(gymCount ?? 0)} accent="emerald" />
        <Kpi label="Total profiles" value={String(profileCount ?? 0)} accent="blue" />
        <Kpi label="Platform revenue 30d" value={fmtNaira(revenue30)} accent="purple" />
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
