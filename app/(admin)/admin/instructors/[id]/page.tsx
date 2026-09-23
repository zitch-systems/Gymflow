import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Mail, Phone, ShieldCheck, CalendarDays, Users, CalendarCheck, Dumbbell, BadgeCheck } from 'lucide-react';
import { requireStaff, MANAGER_ROLES } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fmtNaira, fmtDate, watDayStartUtc, watMonthStartISO } from '@/lib/format';

export const metadata = { title: 'Staff member' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ROLE_LABEL: Record<string, string> = {
  gym_owner: 'Owner', manager: 'Manager', instructor: 'Instructor', front_desk: 'Front desk', accountant: 'Accountant',
};
const ROLE_DESC: Record<string, string> = {
  gym_owner: 'Full access to everything', manager: 'Everything except billing', instructor: 'Classes & PT clients',
  front_desk: 'Check-in & members', accountant: 'Billing & payouts',
};

export default async function StaffDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // The Staff list + nav link are manager-only (front desk shouldn't see staff
  // pay/PT-client detail); match that here instead of the bare requireStaff()
  // that used to let front desk reach any staff member's page by direct URL.
  const { gym } = await requireStaff(MANAGER_ROLES);
  const supabase = await createClient();

  // Read the staff member's profile + link with the service-role client when
  // available. A suspended (is_active=false) colleague isn't visible through the
  // can_see_profile RLS, so on the user client this page would 404 for a
  // suspended staffer (e.g. when opening them to reactivate). This page is
  // already manager-gated and we only render when the person has a staff link at
  // THIS gym, so the read stays gym-scoped. Falls back to the user client where
  // no service-role key is configured.
  const reader = (() => { try { return createAdminClient(); } catch { return supabase; } })();
  const [{ data: profile }, { data: link }] = await Promise.all([
    reader.from('profiles').select('id, full_name, first_name, last_name, email, phone').eq('id', id).maybeSingle(),
    reader.from('gym_staff_links').select('role, joined_at, is_active').eq('gym_id', gym.id).eq('user_id', id).maybeSingle(),
  ]);
  if (!profile || !link) notFound();

  const role = (link.role as string) ?? '';
  const isInstructor = role === 'instructor';
  const monthStart = new Date(watDayStartUtc(watMonthStartISO()));

  const [{ data: clients }, { count: sessions30 }, { count: classesCount }] = await Promise.all([
    supabase.from('instructor_subscriptions').select('member_id, status, end_date, amount_paid').eq('instructor_id', id).eq('gym_id', gym.id).eq('status', 'active'),
    supabase.from('instructor_sessions').select('id', { count: 'exact', head: true }).eq('instructor_id', id).eq('gym_id', gym.id).eq('status', 'completed').gte('scheduled_at', monthStart.toISOString()),
    supabase.from('class_schedules').select('id', { count: 'exact', head: true }).eq('instructor_id', id).eq('gym_id', gym.id),
  ]);
  const clientList = clients ?? [];
  const clientIds = [...new Set(clientList.map((c) => c.member_id).filter(Boolean) as string[])];
  const { data: cProfiles } = clientIds.length
    ? await supabase.from('profiles').select('id, full_name, email').in('id', clientIds)
    : { data: [] as { id: string; full_name: string | null; email: string | null }[] };
  const nameById = new Map((cProfiles ?? []).map((p) => [p.id, p.full_name ?? p.email ?? 'Member']));

  const name = profile.full_name || [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email || 'Staff';
  const initial = name.charAt(0).toUpperCase();

  const STATS = isInstructor
    ? [
        { icon: Users, fg: '#11d18b', bg: '#11d18b1f', val: String(clientList.length), lbl: 'Active clients' },
        { icon: CalendarCheck, fg: '#4080ff', bg: '#4080ff1f', val: String(sessions30 ?? 0), lbl: 'Sessions (mo)' },
        { icon: CalendarDays, fg: '#a8d92e', bg: '#c6f24e24', val: String(classesCount ?? 0), lbl: 'Classes' },
        { icon: CalendarDays, fg: '#ffb020', bg: '#ffb0201f', val: link.joined_at ? fmtDate(link.joined_at) : '—', lbl: 'Joined' },
      ]
    : [
        { icon: ShieldCheck, fg: '#11d18b', bg: '#11d18b1f', val: ROLE_LABEL[role] ?? role, lbl: 'Role' },
        { icon: BadgeCheck, fg: link.is_active ? '#11d18b' : '#ff4560', bg: link.is_active ? '#11d18b1f' : '#ff45601f', val: link.is_active ? 'Active' : 'Inactive', lbl: 'Status' },
        { icon: CalendarDays, fg: '#ffb020', bg: '#ffb0201f', val: link.joined_at ? fmtDate(link.joined_at) : '—', lbl: 'Joined' },
      ];

  const details = [
    { icon: ShieldCheck, label: 'Role', value: `${ROLE_LABEL[role] ?? role} · ${ROLE_DESC[role] ?? ''}` },
    { icon: Mail, label: 'Email', value: profile.email },
    { icon: Phone, label: 'Phone', value: profile.phone },
    { icon: CalendarDays, label: 'Joined', value: link.joined_at ? fmtDate(link.joined_at) : null },
    { icon: BadgeCheck, label: 'Status', value: link.is_active ? 'Active' : 'Inactive' },
  ].filter((d) => d.value);

  return (
    <>
      <Link href="/admin/instructors" className="back-link"><ArrowLeft strokeWidth={2} size={16} /> Back to staff</Link>

      <div className="mdh">
        <span className="gf-avatar gf-avatar-xl">{initial}</span>
        <div className="mdh-id">
          <div className="mdh-name"><h1>{name}</h1><span className="gf-badge gf-badge-brand">{ROLE_LABEL[role] ?? role}</span>{!link.is_active && <span className="gf-badge gf-badge-danger">Inactive</span>}</div>
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
            <div className="panel-h"><h3>Profile &amp; access</h3></div>
            <div className="infolist">
              {details.map((d) => { const Icon = d.icon; return (
                <div className="info-row" key={d.label}>
                  <span className="info-ic"><Icon strokeWidth={1.8} size={16} /></span>
                  <span className="info-lbl">{d.label}</span>
                  <span className="info-val">{d.value}</span>
                </div>
              ); })}
            </div>
          </div>
        </div>

        <div className="md-col">
          <div className="panel">
            <div className="panel-h"><h3>{isInstructor ? 'PT clients' : 'Activity'}</h3>{isInstructor && <span className="sub">{clientList.length} active</span>}</div>
            {!isInstructor ? (
              <div className="empty sm"><div className="eic"><ShieldCheck strokeWidth={1.6} /></div><h3>{ROLE_LABEL[role] ?? role}</h3><p>This role doesn’t coach PT clients.</p></div>
            ) : clientList.length === 0 ? (
              <div className="empty sm"><div className="eic"><Dumbbell strokeWidth={1.6} /></div><h3>No active clients</h3><p>PT clients appear here when this instructor sells a pack.</p></div>
            ) : (
              <div className="ci-list">
                {clientList.map((c, i) => (
                  <div className="ci-item" key={i}>
                    <span className="ci-ic"><Dumbbell strokeWidth={1.8} size={16} /></span>
                    <div className="ci-m"><strong>{c.member_id ? (nameById.get(c.member_id) ?? 'Member') : 'Member'}</strong><small>{c.end_date ? `Renews ${fmtDate(c.end_date)}` : 'Active pack'}</small></div>
                    <span className="naira">{fmtNaira(Number(c.amount_paid ?? 0))}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
