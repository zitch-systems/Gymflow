import Link from 'next/link';
import { Users, GraduationCap, Banknote, Crown, Shield, ScanLine, ChevronRight, UserPlus } from 'lucide-react';
import { requireStaff } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { PayoutQueue, type QueuedPayout } from '@/components/admin/payout-queue';

export const metadata = { title: 'Staff' };

const ROLE_LABEL: Record<string, string> = {
  gym_owner: 'Owner', manager: 'Manager', instructor: 'Instructor', front_desk: 'Front desk', accountant: 'Accountant',
};
const ROLE_META: Record<string, { icon: typeof Crown; fg: string; bg: string; desc: string }> = {
  gym_owner: { icon: Crown, fg: 'var(--gf-brand)', bg: 'var(--gf-brand-soft)', desc: 'Full access' },
  manager: { icon: Shield, fg: '#4080ff', bg: '#4080ff1f', desc: 'All but billing' },
  instructor: { icon: GraduationCap, fg: '#a8d92e', bg: '#c6f24e1f', desc: 'Classes & clients' },
  front_desk: { icon: ScanLine, fg: '#ffb020', bg: '#ffb0201f', desc: 'Check-in & members' },
  accountant: { icon: Banknote, fg: '#4080ff', bg: '#4080ff1f', desc: 'Billing & payouts' },
};

export default async function AdminStaff() {
  const { gym } = await requireStaff();
  const supabase = await createClient();

  const [{ data: staff }, { data: openPayouts }] = await Promise.all([
    supabase.from('gym_staff_links')
      .select('user_id, role, is_active, joined_at')
      .eq('gym_id', gym.id).eq('is_active', true),
    supabase.from('instructor_payouts')
      .select('id, instructor_id, amount, status, requested_at, bank_name, account_name, account_number, notes')
      .eq('gym_id', gym.id).in('status', ['requested', 'approved'])
      .order('requested_at', { ascending: true }),
  ]);

  const ids = [...new Set([
    ...(staff ?? []).map((s) => s.user_id),
    ...(openPayouts ?? []).map((p) => p.instructor_id),
  ].filter(Boolean) as string[])];
  const { data: profiles } = ids.length
    ? await supabase.from('profiles').select('id, full_name, email').in('id', ids)
    : { data: [] as { id: string; full_name: string | null; email: string | null }[] };
  const pById = new Map((profiles ?? []).map((p) => [p.id, p]));

  const queue: QueuedPayout[] = (openPayouts ?? []).map((p) => {
    const prof = pById.get(p.instructor_id);
    return {
      id: p.id,
      instructorName: prof?.full_name ?? prof?.email ?? 'Instructor',
      amount: Number(p.amount ?? 0),
      status: p.status ?? 'requested',
      requestedAt: p.requested_at,
      bank: [p.bank_name, p.account_name, p.account_number ? `····${String(p.account_number).slice(-4)}` : null].filter(Boolean).join(' · '),
      notes: p.notes,
    };
  });

  const rows = (staff ?? []).map((s) => {
    const p = pById.get(s.user_id);
    const name = p?.full_name ?? p?.email ?? 'Staff';
    return { id: s.user_id, name, initial: name.charAt(0).toUpperCase(), role: s.role as string };
  });

  const roleCounts = rows.reduce<Record<string, number>>((acc, r) => { acc[r.role] = (acc[r.role] ?? 0) + 1; return acc; }, {});
  const instructors = roleCounts['instructor'] ?? 0;

  const KPIS = [
    { icon: Users, fg: '#11d18b', bg: '#11d18b1f', val: String(rows.length), lbl: 'Team members' },
    { icon: GraduationCap, fg: '#a8d92e', bg: '#c6f24e1f', val: String(instructors), lbl: 'Instructors' },
    { icon: Shield, fg: '#4080ff', bg: '#4080ff1f', val: String(roleCounts['manager'] ?? 0), lbl: 'Managers' },
    { icon: Crown, fg: '#ffb020', bg: '#ffb0201f', val: String(roleCounts['gym_owner'] ?? 0), lbl: 'Owners' },
  ];

  return (
    <>
      <div className="page-h">
        <div><h1>Staff</h1><p>{rows.length} team member{rows.length === 1 ? '' : 's'} · {instructors} instructor{instructors === 1 ? '' : 's'}</p></div>
        <Link href="/admin/instructors/new" className="gf-btn gf-btn-primary"><UserPlus strokeWidth={1.9} size={16} /> Add staff</Link>
      </div>

      <section className="kpis">
        {KPIS.map((k) => { const Icon = k.icon; return (
          <div className="kpi" key={k.lbl}><div className="kpi-top"><div className="kpi-ic" style={{ background: k.bg, color: k.fg }}><Icon strokeWidth={1.9} /></div></div><div className="kpi-val">{k.val}</div><div className="kpi-lbl">{k.lbl}</div></div>
        ); })}
      </section>

      <PayoutQueue payouts={queue} />

      <div className="grid2">
        <div className="panel">
          <div className="panel-h"><div><h3>Team</h3><div className="sub">Roles &amp; access</div></div></div>
          {rows.length === 0 ? (
            <div className="empty"><div className="eic"><Users strokeWidth={1.6} /></div><h3>No staff yet</h3><p>Invite instructors and front-desk staff to your gym.</p><Link href="/admin/instructors/new" className="gf-btn gf-btn-primary gf-btn-sm" style={{ marginTop: 14 }}><UserPlus strokeWidth={1.9} size={15} /> Add staff</Link></div>
          ) : (
            <table className="tbl">
              <thead><tr><th>Member</th><th>Role</th><th style={{ textAlign: 'right' }}>Status</th><th aria-hidden /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="rowlink">
                    <td><Link href={`/admin/instructors/${r.id}`} className="who"><span className="gf-avatar gf-avatar-sm">{r.initial}</span><div><strong>{r.name}</strong></div></Link></td>
                    <td><span className="role-chip" style={{ background: 'var(--gf-elevated)' }}>{ROLE_LABEL[r.role] ?? r.role}</span></td>
                    <td style={{ textAlign: 'right' }}><span className="gf-badge gf-badge-success">Active</span></td>
                    <td style={{ textAlign: 'right', width: 36 }}><Link href={`/admin/instructors/${r.id}`} className="row-chev" aria-label={`View ${r.name}`}><ChevronRight strokeWidth={2} size={16} /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel">
          <div className="panel-h"><div><h3>Roles</h3><div className="sub">Access levels in use</div></div></div>
          <div className="role-grid">
            {Object.entries(roleCounts).map(([role, count]) => {
              const meta = ROLE_META[role] ?? { icon: Users, fg: 'var(--gf-text-muted)', bg: 'var(--gf-elevated)', desc: '' };
              const Icon = meta.icon;
              return (
                <div className="role-row" key={role}>
                  <div className="ic" style={{ background: meta.bg, color: meta.fg }}><Icon strokeWidth={1.9} /></div>
                  <div className="m"><strong>{ROLE_LABEL[role] ?? role}</strong><small>{meta.desc}</small></div>
                  <span className="ct">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
