import Link from 'next/link';
import { requireInstructor } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { signOut } from '@/lib/auth/actions';
import { fmtDate } from '@/lib/format';

type PageProps = { params: Promise<{ slug: string }> };

export default async function CoachDashboard({ params }: PageProps) {
  const { slug } = await params;
  const { gym, user } = await requireInstructor(slug);
  const supabase = await createClient();

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const today = now.toISOString().slice(0, 10);
  const sevenDays = new Date(now.getTime() + 7 * 86_400_000).toISOString();

  const [{ count: clientCount }, { count: activeSubs }, { data: monthSubs }, { data: upcoming }] = await Promise.all([
    supabase
      .from('instructor_subscriptions')
      .select('member_id', { count: 'exact', head: true })
      .eq('gym_id', gym.id)
      .eq('instructor_id', user.id),
    supabase
      .from('instructor_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('gym_id', gym.id)
      .eq('instructor_id', user.id)
      .eq('status', 'active')
      .gte('end_date', today),
    supabase
      .from('instructor_subscriptions')
      .select('amount_paid')
      .eq('gym_id', gym.id)
      .eq('instructor_id', user.id)
      .gte('created_at', monthStart),
    supabase
      .from('instructor_sessions')
      .select('id, scheduled_at, status, member_id, profiles:member_id(full_name)')
      .eq('gym_id', gym.id)
      .eq('instructor_id', user.id)
      .eq('status', 'scheduled')
      .gte('scheduled_at', now.toISOString())
      .lte('scheduled_at', sevenDays)
      .order('scheduled_at', { ascending: true })
      .limit(5),
  ]);

  const monthRevenue = (monthSubs ?? []).reduce((s, r) => s + (Number(r.amount_paid) || 0), 0);
  const sharePct = gym.instructor_revenue_share_pct ?? 50;
  const myCut = Math.round((monthRevenue * sharePct) / 100);

  return (
    <div className="member-portal">
      <header className="member-header">
        <div>
          <h1 className="gf-page-title">Coach</h1>
          <p className="gf-page-subtitle">{gym.name}</p>
        </div>
        <form action={signOut}>
          <button type="submit" className="gf-btn gf-btn-ghost gf-btn-sm">Sign out</button>
        </form>
      </header>

      <section className="member-quick-actions" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        <div className="gf-card" style={{ padding: 16 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--gf-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Clients</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, marginTop: 4 }}>{clientCount ?? 0}</div>
        </div>
        <div className="gf-card" style={{ padding: 16 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--gf-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Active subs</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, marginTop: 4 }}>{activeSubs ?? 0}</div>
        </div>
        <div className="gf-card" style={{ padding: 16 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--gf-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>This month</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, marginTop: 4 }}>₦{monthRevenue.toLocaleString('en-NG')}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--gf-text-muted)', marginTop: 4 }}>Your share: ₦{myCut.toLocaleString('en-NG')} ({sharePct}%)</div>
        </div>
        <div className="gf-card" style={{ padding: 16 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--gf-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Upcoming (7d)</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, marginTop: 4 }}>{upcoming?.length ?? 0}</div>
        </div>
      </section>

      <section className="member-quick-actions">
        <Link href="/coach/clients" className="gf-quick-action">
          <span aria-hidden>👥</span><span>Clients</span>
        </Link>
        <Link href="/coach/attendance" className="gf-quick-action">
          <span aria-hidden>✅</span><span>Attendance</span>
        </Link>
        <Link href="/coach/timetable" className="gf-quick-action">
          <span aria-hidden>📅</span><span>Timetable</span>
        </Link>
        <Link href="/coach/earnings" className="gf-quick-action">
          <span aria-hidden>💰</span><span>Earnings</span>
        </Link>
        <Link href="/coach/profile" className="gf-quick-action">
          <span aria-hidden>👤</span><span>Profile</span>
        </Link>
      </section>

      {upcoming && upcoming.length > 0 && (
        <div className="gf-card">
          <header className="gf-card-header">
            <h2 className="gf-card-title">Upcoming sessions</h2>
          </header>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {upcoming.map((s) => {
              const p = Array.isArray(s.profiles) ? s.profiles[0] : s.profiles;
              return (
                <li key={s.id} style={{ padding: '12px 18px', borderTop: '1px solid var(--gf-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{p?.full_name ?? 'Member'}</div>
                    <div style={{ fontSize: '0.8125rem', color: 'var(--gf-text-muted)' }}>{fmtDate(s.scheduled_at)} · {new Date(s.scheduled_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
