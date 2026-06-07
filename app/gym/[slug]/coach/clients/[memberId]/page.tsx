import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireInstructor } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';

type PageProps = { params: Promise<{ slug: string; memberId: string }> };

export default async function CoachClientDetailPage({ params }: PageProps) {
  const { slug, memberId } = await params;
  const { gym, user } = await requireInstructor(slug);
  const supabase = await createClient();

  const { data: member } = await supabase
    .from('profiles')
    .select('id, full_name, email, phone')
    .eq('id', memberId)
    .maybeSingle();
  if (!member) notFound();

  const [{ data: subs }, { data: sessions }] = await Promise.all([
    supabase
      .from('instructor_subscriptions')
      .select('id, status, start_date, end_date, amount_paid, created_at')
      .eq('gym_id', gym.id)
      .eq('instructor_id', user.id)
      .eq('member_id', memberId)
      .order('created_at', { ascending: false }),
    supabase
      .from('instructor_sessions')
      .select('id, scheduled_at, duration_minutes, status, notes')
      .eq('gym_id', gym.id)
      .eq('instructor_id', user.id)
      .eq('member_id', memberId)
      .order('scheduled_at', { ascending: false })
      .limit(50),
  ]);

  const totalPaid = (subs ?? []).reduce((s, r) => s + (Number(r.amount_paid) || 0), 0);

  return (
    <div className="op-mobile member-portal">
      <header className="member-header">
        <div>
          <h1 className="gf-page-title">{member.full_name ?? member.email ?? 'Member'}</h1>
          <p className="gf-page-subtitle">{member.email ?? member.phone ?? ''}</p>
        </div>
        <Link href="/coach/clients" className="gf-btn gf-btn-ghost gf-btn-sm">Back</Link>
      </header>

      <section className="gf-card">
        <header className="gf-card-header"><h2 className="gf-card-title">Subscriptions</h2></header>
        {subs && subs.length > 0 ? (
          <div className="gf-table-wrap">
            <table className="gf-table">
              <thead><tr><th>Status</th><th>Start</th><th>End</th><th>Paid</th></tr></thead>
              <tbody>
                {subs.map((s) => (
                  <tr key={s.id}>
                    <td><span className={`status-pill ${s.status === 'active' ? 'on' : 'off'}`}>{s.status ?? '—'}</span></td>
                    <td>{s.start_date ? fmtDate(s.start_date) : '—'}</td>
                    <td>{s.end_date ? fmtDate(s.end_date) : '—'}</td>
                    <td>₦{Number(s.amount_paid ?? 0).toLocaleString('en-NG')}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={3} style={{ textAlign: 'right', fontWeight: 600 }}>Total</td><td style={{ fontWeight: 600 }}>₦{totalPaid.toLocaleString('en-NG')}</td></tr></tfoot>
            </table>
          </div>
        ) : (
          <div style={{ padding: 18, color: 'var(--gf-text-muted)' }}>No subscriptions on record.</div>
        )}
      </section>

      <section className="gf-card">
        <header className="gf-card-header"><h2 className="gf-card-title">Session history</h2></header>
        {sessions && sessions.length > 0 ? (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {sessions.map((s) => (
              <li key={s.id} style={{ padding: '12px 18px', borderTop: '1px solid var(--gf-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{fmtDate(s.scheduled_at)} · {new Date(s.scheduled_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}</div>
                    <div style={{ fontSize: '0.8125rem', color: 'var(--gf-text-muted)' }}>{s.duration_minutes} min{s.notes ? ` · ${s.notes}` : ''}</div>
                  </div>
                  <span className={`status-pill ${s.status === 'completed' ? 'on' : 'off'}`}>{s.status}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div style={{ padding: 18, color: 'var(--gf-text-muted)' }}>No sessions yet.</div>
        )}
      </section>
    </div>
  );
}
