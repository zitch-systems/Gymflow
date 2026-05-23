import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime } from '@/lib/format';

type PageProps = { params: Promise<{ slug: string }> };

export default async function AdminRemindersPage({ params }: PageProps) {
  const { slug } = await params;
  const { gym } = await requireStaff(slug);

  const supabase = await createClient();
  const [{ data: logs }, { data: members }] = await Promise.all([
    supabase
      .from('reminder_logs')
      .select('id, created_at, action, channel, message_preview, recipient_count, sent_count, failed_count')
      .eq('gym_id', gym.id)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('memberships')
      .select('member_id, end_date, profiles:member_id(full_name, email, phone)')
      .eq('gym_id', gym.id)
      .eq('status', 'active')
      .gte('end_date', new Date().toISOString().split('T')[0])
      .lte('end_date', new Date(Date.now() + 7 * 86_400_000).toISOString().split('T')[0])
      .order('end_date', { ascending: true })
      .limit(50),
  ]);

  return (
    <div className="gf-page">
      <header className="gf-page-header">
        <div>
          <h1 className="gf-page-title">Reminders</h1>
          <p className="gf-page-subtitle">Members expiring within 7 days and recent reminder activity.</p>
        </div>
      </header>

      <section className="gf-card">
        <header className="gf-card-header">
          <h2 className="gf-card-title">Expiring this week</h2>
        </header>
        {members && members.length > 0 ? (
          <div className="gf-table-wrap">
            <table className="gf-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Email / Phone</th>
                  <th>Expires</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m, i) => {
                  const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
                  return (
                    <tr key={`${m.member_id ?? 'm'}-${i}`}>
                      <td style={{ fontWeight: 600 }}>{p?.full_name ?? '—'}</td>
                      <td>
                        <div>{p?.email ?? '—'}</div>
                        <div className="gf-table-meta">{p?.phone ?? '—'}</div>
                      </td>
                      <td>{m.end_date}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="gf-empty">
            <div className="gf-empty-icon">📨</div>
            <div className="gf-empty-title">No members expiring this week</div>
          </div>
        )}
      </section>

      <section className="gf-card">
        <header className="gf-card-header">
          <h2 className="gf-card-title">Recent reminders sent</h2>
        </header>
        {logs && logs.length > 0 ? (
          <ul className="gf-list">
            {logs.map((l) => (
              <li key={l.id} className="gf-list-row">
                <span>
                  <strong>{l.action} · {l.channel}</strong>
                  <span className="gf-table-meta">
                    {' · '}
                    {l.sent_count}/{l.recipient_count} sent
                    {l.failed_count > 0 ? ` · ${l.failed_count} failed` : ''}
                    {l.message_preview ? ` — ${l.message_preview.slice(0, 60)}` : ''}
                  </span>
                </span>
                <span className="gf-table-meta">{l.created_at ? fmtDateTime(l.created_at) : '—'}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="gf-empty">
            <div className="gf-empty-icon">📋</div>
            <div className="gf-empty-title">No reminders sent yet</div>
            <div className="gf-empty-text">
              Automated reminders engine ships next; reminders sent via the API or external jobs will appear here.
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
