import Link from 'next/link';
import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira } from '@/lib/format';
import { signOut } from '@/lib/auth/actions';

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function AdminDashboard({ params }: PageProps) {
  const { slug } = await params;
  const { role, gym } = await requireStaff(slug);

  const supabase = await createClient();

  const [{ count: memberCount }, { count: activeToday }, { count: expiringSoon }] = await Promise.all([
    supabase
      .from('gym_member_links')
      .select('*', { count: 'exact', head: true })
      .eq('gym_id', gym.id),
    supabase
      .from('check_ins')
      .select('*', { count: 'exact', head: true })
      .eq('gym_id', gym.id)
      .gte('checked_in_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
    supabase
      .from('memberships')
      .select('*', { count: 'exact', head: true })
      .eq('gym_id', gym.id)
      .gte('end_date', new Date().toISOString())
      .lte('end_date', new Date(Date.now() + 7 * 86_400_000).toISOString()),
  ]);

  return (
    <div className="gf-page">
      <header className="gf-page-header">
        <div>
          <h1 className="gf-page-title">{gym.name}</h1>
          <p className="gf-page-subtitle">Admin Dashboard · {role}</p>
        </div>
        <form action={signOut}>
          <button type="submit" className="gf-btn gf-btn-ghost gf-btn-sm">
            Sign out
          </button>
        </form>
      </header>

      <section className="gf-kpi-grid">
        <KpiCard label="Total members" value={String(memberCount ?? 0)} accent="emerald" />
        <KpiCard label="Active today" value={String(activeToday ?? 0)} accent="blue" />
        <KpiCard label="Expiring this week" value={String(expiringSoon ?? 0)} accent="amber" />
        <KpiCard label="Revenue today" value={fmtNaira(0)} accent="purple" />
      </section>

      <section className="gf-quick-actions">
        <Link href="/admin/members" className="gf-quick-action">
          <span aria-hidden>👥</span>
          <span>Members</span>
        </Link>
        <Link href="/admin/pricing" className="gf-quick-action">
          <span aria-hidden>💰</span>
          <span>Pricing</span>
        </Link>
        <Link href="/admin/analytics" className="gf-quick-action">
          <span aria-hidden>📊</span>
          <span>Analytics</span>
        </Link>
        <Link href="/admin/operations" className="gf-quick-action">
          <span aria-hidden>⚙️</span>
          <span>Operations</span>
        </Link>
      </section>

      <div className="gf-card">
        <header className="gf-card-header">
          <h2 className="gf-card-title">Recent members</h2>
          <Link href="/admin/members" className="gf-btn gf-btn-sm gf-btn-primary">
            + Add member
          </Link>
        </header>
        <div className="gf-empty">
          <div className="gf-empty-icon">👥</div>
          <div className="gf-empty-title">Member list pending</div>
          <div className="gf-empty-text">The full members table comes in the next port.</div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: 'emerald' | 'blue' | 'amber' | 'purple';
}) {
  return (
    <div className={`gf-kpi gf-kpi-${accent}`}>
      <div className="gf-kpi-value">{value}</div>
      <div className="gf-kpi-label">{label}</div>
    </div>
  );
}
