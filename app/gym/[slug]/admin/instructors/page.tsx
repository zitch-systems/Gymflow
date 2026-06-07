import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';
import { InviteInstructorForm } from './invite-form';
import { InstructorRowActions } from './row-actions';
import { EmptyState } from '@/components/ui/empty-state';
import { Stat } from '@/components/ui/stat';
import { GraduationCap, Users, BadgeCheck, Crown } from 'lucide-react';

type PageProps = { params: Promise<{ slug: string }> };

export default async function AdminInstructorsPage({ params }: PageProps) {
  const { slug } = await params;
  const { gym } = await requireStaff(slug);

  const supabase = await createClient();
  const [{ data: instructorLinks }, { data: allStaff }] = await Promise.all([
    supabase
      .from('gym_staff_links')
      .select('user_id, role, is_active, hire_date, joined_at, profiles:user_id(full_name, email, phone)')
      .eq('gym_id', gym.id)
      .eq('role', 'instructor')
      .order('joined_at', { ascending: false }),
    // All staff for the role breakdown panel.
    supabase
      .from('gym_staff_links')
      .select('role, is_active')
      .eq('gym_id', gym.id),
  ]);

  const totalInstructors = (instructorLinks ?? []).length;
  const activeInstructors = (instructorLinks ?? []).filter((l) => l.is_active).length;

  // Role breakdown — count staff per role.
  const ROLE_LABEL: Record<string, string> = {
    gym_owner: 'Owner',
    owner: 'Owner',
    manager: 'Manager',
    instructor: 'Instructor',
    front_desk: 'Front desk',
    accountant: 'Accountant',
  };
  const ROLE_ICON_STYLE: Record<string, { fg: string; bg: string }> = {
    owner: { fg: '#11d18b', bg: 'rgba(17,209,139,0.12)' },
    manager: { fg: '#4080ff', bg: 'rgba(64,128,255,0.12)' },
    instructor: { fg: '#a8d92e', bg: 'rgba(198,242,78,0.12)' },
    front_desk: { fg: '#ffb020', bg: 'rgba(255,176,32,0.12)' },
    accountant: { fg: '#a855f7', bg: 'rgba(168,85,247,0.12)' },
  };
  const ROLE_DESC: Record<string, string> = {
    owner: 'Full access',
    manager: 'All but billing',
    instructor: 'Classes & clients',
    front_desk: 'Check-in & members',
    accountant: 'Wallet & payouts',
  };
  const roleCounts = new Map<string, number>();
  for (const s of allStaff ?? []) {
    if (!s.role || !s.is_active) continue;
    const k = s.role === 'gym_owner' ? 'owner' : s.role;
    roleCounts.set(k, (roleCounts.get(k) ?? 0) + 1);
  }
  // Stable display order: Owner → Manager → Instructor → Front desk → Accountant.
  const ROLE_ORDER = ['owner', 'manager', 'instructor', 'front_desk', 'accountant'];
  const roleRows = ROLE_ORDER
    .map((k) => ({ key: k, count: roleCounts.get(k) ?? 0 }))
    .filter((r) => r.count > 0);

  const totalTeam = Array.from(roleCounts.values()).reduce((a, b) => a + b, 0);

  return (
    <div className="gf-page">
      <div className="page-h">
        <div>
          <h1>Instructors</h1>
          <p>{totalTeam} team member{totalTeam === 1 ? '' : 's'} · {totalInstructors} instructor{totalInstructors === 1 ? '' : 's'} at {gym.name}</p>
        </div>
      </div>

      <section className="kpis">
        <Stat label="Team members" value={totalTeam} accent="emerald" icon={Users} />
        <Stat label="Instructors" value={totalInstructors} accent="lime" icon={GraduationCap} />
        <Stat label="Active" value={activeInstructors} accent="blue" icon={BadgeCheck} />
        <Stat label="Owners + managers" value={(roleCounts.get('owner') ?? 0) + (roleCounts.get('manager') ?? 0)} accent="amber" icon={Crown} />
      </section>

      <div className="adm-grid">
        <div>
          <div className="panel">
            <div className="panel-h">
              <div>
                <h3>Instructors</h3>
                <div className="sub">Coaches who run classes &amp; 1-on-1 sessions</div>
              </div>
            </div>
            {instructorLinks && instructorLinks.length > 0 ? (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Contact</th>
                    <th>Joined</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }} />
                  </tr>
                </thead>
                <tbody>
                  {instructorLinks.map((l) => {
                    const p = Array.isArray(l.profiles) ? l.profiles[0] : l.profiles;
                    const name = p?.full_name ?? '—';
                    const initial = (name === '—' ? '?' : name.charAt(0)).toUpperCase();
                    return (
                      <tr key={l.user_id ?? ''}>
                        <td>
                          <div className="who">
                            <span className="gf-avatar gf-avatar-sm">{initial}</span>
                            <div>
                              <strong>{name}</strong>
                              <small>Instructor</small>
                            </div>
                          </div>
                        </td>
                        <td style={{ color: 'var(--gf-text-secondary)' }}>
                          <div>{p?.email ?? '—'}</div>
                          {p?.phone ? <div style={{ fontSize: '0.74rem', color: 'var(--gf-text-muted)' }}>{p.phone}</div> : null}
                        </td>
                        <td style={{ color: 'var(--gf-text-secondary)' }}>
                          {l.hire_date ? fmtDate(l.hire_date) : l.joined_at ? fmtDate(l.joined_at) : '—'}
                        </td>
                        <td>
                          <span className={`gf-badge ${l.is_active ? 'gf-badge-success' : 'gf-badge-neutral'}`}>
                            <span className="gf-dot" />
                            {l.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {l.user_id && <InstructorRowActions slug={slug} userId={l.user_id} active={!!l.is_active} />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <EmptyState icon={GraduationCap} title="No instructors invited yet" />
            )}
          </div>
        </div>

        <div>
          <div className="panel">
            <div className="panel-h">
              <div>
                <h3>Team breakdown</h3>
                <div className="sub">Active staff by role</div>
              </div>
            </div>
            {roleRows.length === 0 ? (
              <div className="sub">No active staff yet.</div>
            ) : (
              <div className="role-grid">
                {roleRows.map((r) => {
                  const style = ROLE_ICON_STYLE[r.key] ?? { fg: 'var(--gf-text-muted)', bg: 'var(--gf-elevated)' };
                  return (
                    <div key={r.key} className="role-row">
                      <span className="ic" style={{ background: style.bg, color: style.fg }}>
                        {ROLE_LABEL[r.key]?.charAt(0) ?? '?'}
                      </span>
                      <div className="m">
                        <strong>{ROLE_LABEL[r.key] ?? r.key}</strong>
                        <small>{ROLE_DESC[r.key] ?? ''}</small>
                      </div>
                      <span className="ct">{r.count}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-h">
              <div>
                <h3>Invite an instructor</h3>
                <div className="sub">Send a coach the join link for {gym.name}</div>
              </div>
            </div>
            <InviteInstructorForm slug={slug} />
          </div>
        </div>
      </div>
    </div>
  );
}
