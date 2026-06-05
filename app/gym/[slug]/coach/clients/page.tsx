import Link from 'next/link';
import { requireInstructor } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDate, daysLeft } from '@/lib/format';
import { EmptyState } from '@/components/ui/empty-state';
import { Stat } from '@/components/ui/stat';
import { Dumbbell, CalendarCheck, AlertTriangle, Banknote, Users } from 'lucide-react';

type PageProps = { params: Promise<{ slug: string }> };

const DAY_MS = 86_400_000;

export default async function CoachClientsPage({ params }: PageProps) {
  const { slug } = await params;
  const { gym, user } = await requireInstructor(slug);
  const supabase = await createClient();

  const today = new Date().toISOString().slice(0, 10);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [{ data: subs }, { data: sessions30 }] = await Promise.all([
    supabase
      .from('instructor_subscriptions')
      .select('id, member_id, status, start_date, end_date, amount_paid, profiles:member_id(full_name, email, phone)')
      .eq('gym_id', gym.id)
      .eq('instructor_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('instructor_sessions')
      .select('member_id, scheduled_at, status')
      .eq('gym_id', gym.id)
      .eq('instructor_id', user.id)
      .gte('scheduled_at', monthStart.toISOString()),
  ]);

  // Group by member; last sub wins for status. Compute the next scheduled session
  // per member (if any) for the table's "Next session" column.
  const sessionsByMember = new Map<string, { upcoming: Date | null; doneThisMonth: number }>();
  for (const s of sessions30 ?? []) {
    if (!s.member_id || !s.scheduled_at) continue;
    const t = new Date(s.scheduled_at);
    const acc = sessionsByMember.get(s.member_id) ?? { upcoming: null, doneThisMonth: 0 };
    if (s.status === 'completed') acc.doneThisMonth += 1;
    if (t.getTime() >= new Date().getTime() && (!acc.upcoming || t < acc.upcoming)) acc.upcoming = t;
    sessionsByMember.set(s.member_id, acc);
  }

  type ClientRow = {
    memberId: string;
    name: string;
    email: string | null;
    phone: string | null;
    initial: string;
    status: 'active' | 'expiring' | 'expired';
    endDate: string | null;
    totalPaid: number;
    upcoming: Date | null;
    sessionsThisMonth: number;
  };
  const byMember = new Map<string, ClientRow>();
  for (const s of subs ?? []) {
    if (!s.member_id) continue;
    const p = Array.isArray(s.profiles) ? s.profiles[0] : s.profiles;
    const name = p?.full_name ?? p?.email ?? 'Member';
    const expired = !s.end_date || s.end_date < today;
    const expiring = !expired && s.end_date && daysLeft(s.end_date) <= 7;
    const status: ClientRow['status'] = expired ? 'expired' : expiring ? 'expiring' : 'active';
    const ext = sessionsByMember.get(s.member_id) ?? { upcoming: null, doneThisMonth: 0 };
    const existing = byMember.get(s.member_id);
    if (!existing) {
      byMember.set(s.member_id, {
        memberId: s.member_id,
        name,
        email: p?.email ?? null,
        phone: p?.phone ?? null,
        initial: name.charAt(0).toUpperCase(),
        status,
        endDate: s.end_date,
        totalPaid: Number(s.amount_paid) || 0,
        upcoming: ext.upcoming,
        sessionsThisMonth: ext.doneThisMonth,
      });
    } else {
      existing.totalPaid += Number(s.amount_paid) || 0;
      if (status === 'active') existing.status = 'active';
      else if (status === 'expiring' && existing.status === 'expired') existing.status = 'expiring';
    }
  }

  const clients = Array.from(byMember.values()).sort((a, b) => a.name.localeCompare(b.name));
  const activeCount = clients.filter((c) => c.status === 'active' || c.status === 'expiring').length;
  const expiringCount = clients.filter((c) => c.status === 'expiring').length;
  const sessionsThisMonth = clients.reduce((s, c) => s + c.sessionsThisMonth, 0);
  const monthRevenue = (subs ?? []).reduce((s, sub) => {
    if (!sub.start_date) return s;
    return new Date(sub.start_date).getTime() >= monthStart.getTime()
      ? s + Number(sub.amount_paid ?? 0)
      : s;
  }, 0);

  const STATUS_BADGE: Record<ClientRow['status'], { cls: string; label: string }> = {
    active: { cls: 'gf-badge-success', label: 'Active' },
    expiring: { cls: 'gf-badge-warning', label: 'Expiring' },
    expired: { cls: 'gf-badge-neutral', label: 'Expired' },
  };

  const fmtUpcoming = (t: Date | null) => {
    if (!t) return '—';
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    const diff = Math.floor((t.getTime() - today0.getTime()) / DAY_MS);
    const time = t.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: false });
    if (diff === 0) return `Today ${time}`;
    if (diff === 1) return `Tomorrow ${time}`;
    if (diff < 7) return `${t.toLocaleDateString('en-NG', { weekday: 'short' })} ${time}`;
    return `${fmtDate(t)} · ${time}`;
  };

  return (
    <div className="gf-page">
      <div className="page-h">
        <div>
          <h1>PT clients</h1>
          <p>{activeCount} active · {expiringCount} expiring · {fmtNaira(monthRevenue)} this month</p>
        </div>
      </div>

      <section className="kpis">
        <Stat label="Active clients" value={activeCount} accent="emerald" icon={Dumbbell} />
        <Stat label="Sessions (mo)" value={sessionsThisMonth} accent="blue" icon={CalendarCheck} />
        <Stat label="Expiring soon" value={expiringCount} accent="amber" icon={AlertTriangle} />
        <Stat label="PT revenue (mo)" value={fmtNaira(monthRevenue)} accent="lime" icon={Banknote} />
      </section>

      <div className="panel">
        <div className="panel-h">
          <div>
            <h3>Clients</h3>
            <div className="sub">Pack progress &amp; next session</div>
          </div>
        </div>
        {clients.length === 0 ? (
          <EmptyState icon={Users} title="No clients yet" message="Members who subscribe to you will appear here." />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Client</th>
                <th>Plan</th>
                <th>Next session</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Total paid</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => {
                const badge = STATUS_BADGE[c.status];
                return (
                  <tr key={c.memberId}>
                    <td>
                      <Link href={`/coach/clients/${c.memberId}`} className="who" style={{ textDecoration: 'none', color: 'inherit' }}>
                        <span className="gf-avatar gf-avatar-sm">{c.initial}</span>
                        <div>
                          <strong>{c.name}</strong>
                          <small>{c.email ?? c.phone ?? '1-on-1 PT'}</small>
                        </div>
                      </Link>
                    </td>
                    <td style={{ color: 'var(--gf-text-secondary)' }}>
                      {c.endDate ? `until ${fmtDate(c.endDate)}` : '—'}
                    </td>
                    <td style={{ color: 'var(--gf-text-secondary)' }}>{fmtUpcoming(c.upcoming)}</td>
                    <td>
                      <span className={`gf-badge ${badge.cls}`}>
                        <span className="gf-dot" />
                        {badge.label}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }} className="naira">{fmtNaira(c.totalPaid)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
