import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime } from '@/lib/format';
import { daysFromNowDate, todayDate } from '@/lib/dates';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { MailCheck, Inbox } from 'lucide-react';

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
      .gte('end_date', todayDate())
      .lte('end_date', daysFromNowDate(7))
      .order('end_date', { ascending: true })
      .limit(50),
  ]);

  return (
    <div className="gf-page">
      <PageHeader title="Reminders" subtitle="Members expiring within 7 days and recent reminder activity." />

      <Card>
        <CardHeader title="Expiring this week" />
        {members && members.length > 0 ? (
          <div className="gf-table-wrap">
            <table className="gf-table gf-table-cards">
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
                      <td data-label="Contact">
                        <div>{p?.email ?? '—'}</div>
                        <div className="gf-table-meta">{p?.phone ?? '—'}</div>
                      </td>
                      <td data-label="Expires">{m.end_date}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={MailCheck} title="No members expiring this week" />
        )}
      </Card>

      <Card>
        <CardHeader title="Recent reminders sent" />
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
          <EmptyState
            icon={Inbox}
            title="No reminders sent yet"
            message="Automated reminders engine ships next; reminders sent via the API or external jobs will appear here."
          />
        )}
      </Card>
    </div>
  );
}
