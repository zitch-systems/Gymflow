'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Users, UserPlus, ChevronRight, Power, ShieldCheck } from 'lucide-react';
import { setStaffActive, setStaffRole, type StaffState } from '@/lib/actions/admin-staff';

export type StaffRow = { id: string; name: string; email: string | null; initial: string; role: string; isActive: boolean };

const INIT: StaffState = { ok: false, error: null };
// Roles a manager can assign (never gym_owner — a gym keeps its single owner).
const ASSIGNABLE = [
  ['manager', 'Manager'],
  ['front_desk', 'Front desk'],
  ['accountant', 'Accountant'],
  ['instructor', 'Instructor'],
] as const;

// Team table with inline role change + activate/deactivate. Owner rows and the
// current user's own row are read-only (the server enforces the same rules).
export function StaffManager({ rows, currentUserId, roleLabels }: { rows: StaffRow[]; currentUserId: string; roleLabels: Record<string, string> }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function changeRole(userId: string, role: string) {
    setError(null); setBusyId(userId);
    const fd = new FormData(); fd.set('user_id', userId); fd.set('role', role);
    start(async () => { const r = await setStaffRole(INIT, fd); if (!r.ok) setError(r.error); setBusyId(null); });
  }
  function toggleActive(userId: string, active: boolean) {
    setError(null); setBusyId(userId);
    const fd = new FormData(); fd.set('user_id', userId); fd.set('active', active ? 'true' : 'false');
    start(async () => { const r = await setStaffActive(INIT, fd); if (!r.ok) setError(r.error); setBusyId(null); });
  }

  return (
    <div className="panel">
      <div className="panel-h"><div><h3>Team</h3><div className="sub">Roles &amp; access · activate, deactivate or change a role</div></div></div>
      {error && <p className="act-fb err" style={{ marginBottom: 10 }}>{error}</p>}
      {rows.length === 0 ? (
        <div className="empty"><div className="eic"><Users strokeWidth={1.6} /></div><h3>No staff yet</h3><p>Invite instructors and front-desk staff to your gym.</p><Link href="/admin/instructors/new" className="gf-btn gf-btn-primary gf-btn-sm" style={{ marginTop: 14 }}><UserPlus strokeWidth={1.9} size={15} /> Add staff</Link></div>
      ) : (
        <table className="tbl staff-tbl">
          <thead><tr><th>Member</th><th>Role</th><th style={{ textAlign: 'right' }}>Access</th><th aria-hidden /></tr></thead>
          <tbody>
            {rows.map((r) => {
              const isOwner = r.role === 'gym_owner';
              const isSelf = r.id === currentUserId;
              const locked = isOwner || isSelf;
              const rowBusy = pending && busyId === r.id;
              return (
                <tr key={r.id} style={r.isActive ? undefined : { opacity: 0.55 }}>
                  <td>
                    <Link href={`/admin/instructors/${r.id}`} className="who"><span className="gf-avatar gf-avatar-sm">{r.initial}</span><div><strong>{r.name}</strong>{r.email && <small style={{ display: 'block', color: 'var(--gf-text-muted)' }}>{r.email}</small>}</div></Link>
                  </td>
                  <td>
                    {locked ? (
                      <span className="role-chip" style={{ background: 'var(--gf-elevated)' }}>{isOwner && <ShieldCheck size={12} strokeWidth={2} style={{ verticalAlign: '-2px', marginRight: 4 }} />}{roleLabels[r.role] ?? r.role}</span>
                    ) : (
                      <select className="gf-input staff-role-sel" value={r.role} disabled={rowBusy} onChange={(e) => changeRole(r.id, e.target.value)} aria-label={`Role for ${r.name}`}>
                        {ASSIGNABLE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {locked ? (
                      <span className="gf-badge gf-badge-success">{isOwner ? 'Owner' : 'You'}</span>
                    ) : (
                      <button type="button" className={`gf-btn gf-btn-sm ${r.isActive ? 'gf-btn-secondary' : 'gf-btn-primary'}`} disabled={rowBusy} onClick={() => toggleActive(r.id, !r.isActive)}>
                        <Power size={13} strokeWidth={2} /> {rowBusy ? '…' : r.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', width: 36 }}><Link href={`/admin/instructors/${r.id}`} className="row-chev" aria-label={`View ${r.name}`}><ChevronRight strokeWidth={2} size={16} /></Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
