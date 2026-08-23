import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Mail, Phone, Dumbbell, CalendarCheck, CalendarClock, Banknote, ScanLine } from 'lucide-react';
import { requireInstructor } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDate, fmtDateTime, daysLeft, watDateISO } from '@/lib/format';

export const metadata = { title: 'Client · Instructor' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function sessionBadge(status: string): [string, string] {
  switch (status) {
    case 'completed': return ['gf-badge-success', 'Completed'];
    case 'scheduled': return ['gf-badge-brand', 'Scheduled'];
    case 'no_show': return ['gf-badge-warning', 'No-show'];
    default: return ['gf-badge-danger', 'Cancelled'];
  }
}

export default async function CoachClientDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, gym } = await requireInstructor();
  const supabase = await createClient();

  const [{ data: profile }, { data: subs }, { data: sessions }] = await Promise.all([
    supabase.from('profiles').select('id, full_name, first_name, last_name, email, phone').eq('id', id).maybeSingle(),
    supabase.from('instructor_subscriptions').select('id, status, start_date, end_date, amount_paid, auto_renew').eq('instructor_id', user.id).eq('gym_id', gym.id).eq('member_id', id).order('end_date', { ascending: false }),
    supabase.from('instructor_sessions').select('id, status, scheduled_at, duration_minutes').eq('instructor_id', user.id).eq('gym_id', gym.id).eq('member_id', id).order('scheduled_at', { ascending: false }),
  ]);
  // Only the instructor's own clients are viewable.
  if (!profile || !(subs ?? []).length) notFound();

  const subList = subs ?? [];
  const ses = sessions ?? [];
  const name = profile.full_name || [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email || 'Client';
  const initial = name.charAt(0).toUpperCase();

  // WAT — end_date is a WAT date-only column; a UTC "today" shows a coach
  // an expired membership as still active late in the evening.
  const today = watDateISO();
  const activePack = subList.find((s) => s.status === 'active' && (s.end_date ?? '') >= today) ?? subList[0] ?? null;
  const remaining = activePack?.end_date ? daysLeft(activePack.end_date) : 0;
  const packActive = Boolean(activePack && activePack.status === 'active' && (activePack.end_date ?? '') >= today);
  const completed = ses.filter((s) => s.status === 'completed').length;
  const upcoming = ses.filter((s) => s.status === 'scheduled' && new Date(s.scheduled_at ?? 0).getTime() >= Date.now()).length;
  const ptSpent = subList.reduce((sum, s) => sum + Number(s.amount_paid ?? 0), 0);
  const since = subList.reduce<string | null>((min, s) => (s.start_date && (!min || s.start_date < min) ? s.start_date : min), null);

  const STATS = [
    { icon: CalendarCheck, fg: '#11d18b', bg: '#11d18b1f', val: String(completed), lbl: 'Sessions done' },
    { icon: CalendarClock, fg: '#4080ff', bg: '#4080ff1f', val: String(upcoming), lbl: 'Upcoming' },
    { icon: Banknote, fg: '#a8d92e', bg: '#c6f24e24', val: fmtNaira(ptSpent), lbl: 'PT spend' },
    { icon: Dumbbell, fg: '#ffb020', bg: '#ffb0201f', val: since ? fmtDate(since) : '—', lbl: 'Client since' },
  ];

  const statusBadge: [string, string] = packActive
    ? (remaining <= 7 ? ['gf-badge-warning', `Expiring · ${remaining}d`] : ['gf-badge-success', 'Active pack'])
    : ['gf-badge-danger', 'No active pack'];

  return (
    <>
      <Link href="/coach/clients" className="back-link"><ArrowLeft strokeWidth={2} size={16} /> Back to clients</Link>

      <div className="mdh">
        <span className="gf-avatar gf-avatar-xl">{initial}</span>
        <div className="mdh-id">
          <div className="mdh-name"><h1>{name}</h1><span className={`gf-badge ${statusBadge[0]}`}>{statusBadge[1]}</span></div>
          <div className="mdh-meta">
            {profile.email && <span><Mail strokeWidth={1.8} size={14} /> {profile.email}</span>}
            {profile.phone && <span><Phone strokeWidth={1.8} size={14} /> {profile.phone}</span>}
          </div>
        </div>
        <div className="mdh-actions">
          {profile.email && <a className="gf-btn gf-btn-secondary gf-btn-sm" href={`mailto:${profile.email}`}><Mail strokeWidth={1.9} size={15} /> Email</a>}
        </div>
      </div>

      <section className="kpis">
        {STATS.map((k) => { const Icon = k.icon; return (
          <div className="kpi" key={k.lbl}><div className="kpi-top"><div className="kpi-ic" style={{ background: k.bg, color: k.fg }}><Icon strokeWidth={1.9} /></div></div><div className="kpi-val">{k.val}</div><div className="kpi-lbl">{k.lbl}</div></div>
        ); })}
      </section>

      <div className="md-grid">
        <div className="md-col">
          <div className="panel">
            <div className="panel-h"><h3>PT package</h3></div>
            {activePack ? (
              <div className="md-sub">
                <div className="md-sub-top">
                  <div><strong>Personal training</strong><small>{packActive ? `${remaining} day${remaining === 1 ? '' : 's'} left` : 'Expired'}</small></div>
                  <span className={`gf-badge ${statusBadge[0]}`}>{statusBadge[1]}</span>
                </div>
                <div className="md-sub-rows">
                  <div><span>Start</span><b>{fmtDate(activePack.start_date)}</b></div>
                  <div><span>Ends</span><b>{fmtDate(activePack.end_date)}</b></div>
                  <div><span>Paid</span><b>{fmtNaira(Number(activePack.amount_paid ?? 0))}</b></div>
                  <div><span>Auto-renew</span><b>{activePack.auto_renew ? 'On' : 'Off'}</b></div>
                </div>
                {subList.length > 1 && <div className="md-sub-hist">{subList.length} packages on record</div>}
              </div>
            ) : (
              <div className="empty sm"><div className="eic"><Dumbbell strokeWidth={1.6} /></div><h3>No active package</h3></div>
            )}
          </div>
        </div>

        <div className="md-col">
          <div className="panel">
            <div className="panel-h"><h3>Sessions</h3><span className="sub">{completed} done · {upcoming} upcoming</span></div>
            {ses.length ? (
              <div className="ci-list">
                {ses.map((s) => {
                  const badge = sessionBadge(s.status ?? 'scheduled');
                  return (
                    <div className="ci-item" key={s.id}>
                      <span className="ci-ic"><ScanLine strokeWidth={1.8} size={16} /></span>
                      <div className="ci-m"><strong>{fmtDateTime(s.scheduled_at)}</strong><small>{s.duration_minutes ?? 60} min session</small></div>
                      <span className={`gf-badge ${badge[0]}`}>{badge[1]}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="empty sm"><div className="eic"><CalendarClock strokeWidth={1.6} /></div><h3>No sessions yet</h3></div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
