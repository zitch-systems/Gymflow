import Link from 'next/link';
import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, fmtDateTime, daysLeft } from '@/lib/format';
import { daysFromNowDate, todayDate, daysAgoIso } from '@/lib/dates';
import { EmptyState } from '@/components/ui/empty-state';
import { Stat } from '@/components/ui/stat';
import { Clock, MessageCircle, Reply, Zap, MailCheck, Inbox } from 'lucide-react';

type PageProps = { params: Promise<{ slug: string }> };

export default async function AdminRemindersPage({ params }: PageProps) {
  const { slug } = await params;
  const { gym } = await requireStaff(slug);

  const supabase = await createClient();
  const [{ data: logs }, { data: members }, { count: sentThisMonth }] = await Promise.all([
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
    supabase
      .from('reminder_logs')
      .select('id', { count: 'exact', head: true })
      .eq('gym_id', gym.id)
      .gte('created_at', daysAgoIso(30)),
  ]);

  const expiringCount = (members ?? []).length;
  const sent30 = sentThisMonth ?? 0;
  const recentLogs = logs ?? [];
  const totalSent = recentLogs.reduce((s, l) => s + (l.sent_count ?? 0), 0);
  const totalRecipients = recentLogs.reduce((s, l) => s + (l.recipient_count ?? 0), 0);
  const renewedPct = totalRecipients > 0 ? Math.round((totalSent / totalRecipients) * 100) : 0;

  return (
    <div className="gf-page">
      <div className="page-h">
        <div>
          <h1>Reminders</h1>
          <p>{expiringCount} membership{expiringCount === 1 ? '' : 's'} expiring this week · {sent30} reminders sent in the last 30 days</p>
        </div>
      </div>

      <section className="kpis">
        <Stat label="Expiring this week" value={expiringCount} accent="amber" icon={Clock} />
        <Stat label="Sent (30d)" value={sent30} accent="emerald" icon={MessageCircle} />
        <Stat label="Delivered" value={`${renewedPct}%`} accent="blue" icon={Reply} />
        <Stat label="Auto-reminders" value="On" accent="lime" icon={Zap} />
      </section>

      <section className="adm-grid">
        <div>
          <div className="panel">
            <div className="panel-h">
              <div>
                <h3>Expiring this week</h3>
                <div className="sub">Nudge before they lapse</div>
              </div>
            </div>
            {members && members.length > 0 ? (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Contact</th>
                    <th>Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m, i) => {
                    const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
                    const name = p?.full_name ?? '—';
                    const initial = (name === '—' ? '?' : name.charAt(0)).toUpperCase();
                    const left = daysLeft(m.end_date);
                    return (
                      <tr key={`${m.member_id ?? 'm'}-${i}`}>
                        <td>
                          <Link
                            href={m.member_id ? `/admin/members/${m.member_id}` : '#'}
                            className="who"
                            style={{ textDecoration: 'none', color: 'inherit' }}
                          >
                            <span className="gf-avatar gf-avatar-sm">{initial}</span>
                            <div>
                              <strong>{name}</strong>
                              <small>{p?.email ?? '—'}</small>
                            </div>
                          </Link>
                        </td>
                        <td style={{ color: 'var(--gf-text-secondary)' }}>{p?.phone ?? '—'}</td>
                        <td>
                          <span className="gf-badge gf-badge-warning">
                            <span className="gf-dot" />
                            in {left} day{left === 1 ? '' : 's'}
                          </span>
                          <div style={{ fontSize: '0.72rem', color: 'var(--gf-text-muted)', marginTop: 4 }}>{fmtDate(m.end_date)}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <EmptyState icon={MailCheck} title="No members expiring this week" />
            )}
          </div>
        </div>

        <div>
          <div className="panel">
            <div className="panel-h">
              <div>
                <h3>Recent reminders</h3>
                <div className="sub">Delivery log</div>
              </div>
            </div>
            {recentLogs.length > 0 ? (
              <div className="feed">
                {recentLogs.map((l) => {
                  const ok = (l.failed_count ?? 0) === 0;
                  return (
                    <div key={l.id} className="feed-row">
                      <span className="gf-avatar gf-avatar-sm" aria-hidden style={{ background: ok ? 'var(--gf-brand-soft)' : 'var(--gf-danger-soft)', color: ok ? 'var(--gf-brand)' : 'var(--gf-danger)', borderColor: 'transparent' }}>
                        {l.channel === 'email' ? '@' : l.channel === 'whatsapp' ? 'W' : 'S'}
                      </span>
                      <span className="feed-meta">
                        <strong>{l.action ?? 'Reminder'} · {l.channel ?? 'email'}</strong>
                        <small>
                          {l.sent_count}/{l.recipient_count} sent
                          {(l.failed_count ?? 0) > 0 ? ` · ${l.failed_count} failed` : ''}
                          {l.message_preview ? ` — ${l.message_preview.slice(0, 50)}` : ''}
                        </small>
                      </span>
                      <span className="feed-time">{l.created_at ? fmtDateTime(l.created_at) : '—'}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                icon={Inbox}
                title="No reminders sent yet"
                message="Reminders sent via the cron or external jobs will appear here."
              />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
