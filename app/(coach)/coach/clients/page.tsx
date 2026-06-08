import Link from 'next/link';
import { Dumbbell, CalendarCheck, AlertTriangle, Banknote, ChevronRight } from 'lucide-react';
import { requireInstructor } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDate, daysLeft } from '@/lib/format';

export const metadata = { title: 'PT clients · Instructor' };

export default async function CoachClients() {
  const { user, gym } = await requireInstructor();
  const supabase = await createClient();

  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const [{ data: subs }, { data: sessions }] = await Promise.all([
    supabase.from('instructor_subscriptions')
      .select('id, member_id, status, end_date, amount_paid, start_date')
      .eq('instructor_id', user.id).eq('gym_id', gym.id)
      .order('end_date', { ascending: true }),
    supabase.from('instructor_sessions')
      .select('id, scheduled_at')
      .eq('instructor_id', user.id).eq('gym_id', gym.id).gte('scheduled_at', monthStart.toISOString()),
  ]);

  const active = (subs ?? []).filter((s) => s.status === 'active');
  const expiringSoon = active.filter((s) => s.end_date && daysLeft(s.end_date) <= 7).length;
  const ptRevenueMo = (subs ?? []).filter((s) => s.start_date && new Date(s.start_date) >= monthStart).reduce((sum, s) => sum + Number(s.amount_paid ?? 0), 0);

  const ids = [...new Set(active.map((s) => s.member_id).filter(Boolean) as string[])];
  const { data: profiles } = ids.length
    ? await supabase.from('profiles').select('id, full_name, email').in('id', ids)
    : { data: [] as { id: string; full_name: string | null; email: string | null }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? p.email ?? 'Member']));

  const KPIS = [
    { icon: Dumbbell, fg: '#11d18b', bg: '#11d18b1f', val: String(active.length), lbl: 'Active packs' },
    { icon: CalendarCheck, fg: '#4080ff', bg: '#4080ff1f', val: String((sessions ?? []).length), lbl: 'Sessions this month' },
    { icon: AlertTriangle, fg: '#ffb020', bg: '#ffb0201f', val: String(expiringSoon), lbl: 'Expiring soon' },
    { icon: Banknote, fg: '#a8d92e', bg: '#c6f24e1f', val: fmtNaira(ptRevenueMo), lbl: 'PT revenue (mo)' },
  ];

  return (
    <>
      <div className="hdr"><h1>PT clients</h1><p>{active.length} active pack{active.length === 1 ? '' : 's'} · {expiringSoon} expiring soon</p></div>

      <section className="kpis">
        {KPIS.map((k) => { const Icon = k.icon; return (
          <div className="kpi" key={k.lbl}><div className="kpi-top"><div className="kpi-ic" style={{ background: k.bg, color: k.fg }}><Icon strokeWidth={1.9} /></div></div><div className="kpi-val">{k.val}</div><div className="kpi-lbl">{k.lbl}</div></div>
        ); })}
      </section>

      <div className="panel">
        <div className="panel-h"><div><h3>Clients</h3><div className="sub">Active PT packs</div></div></div>
        {active.length === 0 ? (
          <div className="empty"><div className="eic"><Dumbbell strokeWidth={1.6} /></div><h3>No clients yet</h3><p>Members with an active PT pack with you appear here.</p></div>
        ) : active.map((s) => {
          const nm = s.member_id ? (nameById.get(s.member_id) ?? 'Member') : 'Member';
          return (
            <Link className="cl-row" key={s.id} href={s.member_id ? `/coach/clients/${s.member_id}` : '#'}>
              <span className="gf-avatar gf-avatar-sm">{nm.charAt(0).toUpperCase()}</span>
              <div className="m"><strong>{nm}</strong><small>Active{s.end_date ? ` · renews ${fmtDate(s.end_date)}` : ''}</small></div>
              <span className="naira">{fmtNaira(Number(s.amount_paid ?? 0))}</span>
              <ChevronRight className="chev" strokeWidth={2} size={16} />
            </Link>
          );
        })}
      </div>
    </>
  );
}
