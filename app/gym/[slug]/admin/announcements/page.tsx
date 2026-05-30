import { requireManager } from '@/lib/auth/gym';
import { createAdminClient } from '@/lib/supabase/admin';
import { fmtDateTime } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { AnnouncementForm } from './announcement-form';
import { Megaphone } from 'lucide-react';

type PageProps = { params: Promise<{ slug: string }> };

type SentRow = {
  title: string;
  body: string | null;
  channel: string | null;
  sent_at: string | null;
};

const CHANNEL_LABEL: Record<string, string> = { email: 'Email', whatsapp: 'WhatsApp', both: 'Email + WhatsApp' };

export default async function AdminAnnouncementsPage({ params }: PageProps) {
  const { slug } = await params;
  // Manager-only: broadcasting to every member is a high-trust action.
  const { gym } = await requireManager(slug);
  const admin = createAdminClient();

  // Active member count (recipients) + a digest of recent broadcasts. The
  // notifications table holds one row per recipient per send, so we group by
  // (title, sent_at) to show one line per announcement with its reach.
  const [{ count: memberCount }, { data: notifs }] = await Promise.all([
    admin
      .from('gym_member_links')
      .select('id', { count: 'exact', head: true })
      .eq('gym_id', gym.id)
      .eq('is_active', true)
      .eq('status', 'active'),
    admin
      .from('notifications')
      .select('title, body, channel, sent_at')
      .eq('gym_id', gym.id)
      .eq('type', 'announcement')
      .order('sent_at', { ascending: false })
      .limit(200),
  ]);

  const rows = (notifs ?? []) as SentRow[];
  const sent = new Map<string, { title: string; channel: string | null; sent_at: string | null; count: number }>();
  for (const r of rows) {
    const key = `${r.sent_at}::${r.title}`;
    const existing = sent.get(key);
    if (existing) existing.count += 1;
    else sent.set(key, { title: r.title, channel: r.channel, sent_at: r.sent_at, count: 1 });
  }
  const history = [...sent.values()].slice(0, 30);

  return (
    <div className="gf-page">
      <PageHeader
        title="Announcements"
        subtitle="Broadcast a message to all your active members by email or WhatsApp."
      />

      <Card>
        <CardHeader title="New announcement" />
        <AnnouncementForm slug={slug} memberCount={memberCount ?? 0} />
      </Card>

      <Card>
        <CardHeader title={`Sent (${history.length})`} />
        {history.length > 0 ? (
          <ul className="gf-list">
            {history.map((h, i) => (
              <li key={i} className="gf-list-row">
                <span>
                  <strong>{h.title}</strong>
                  <span className="gf-table-meta"> · {CHANNEL_LABEL[h.channel ?? 'email'] ?? h.channel} · {h.count} recipient{h.count === 1 ? '' : 's'}</span>
                </span>
                <span className="gf-table-meta">{h.sent_at ? fmtDateTime(h.sent_at) : '—'}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={Megaphone} title="No announcements yet" message="Your sent broadcasts will appear here." />
        )}
      </Card>
    </div>
  );
}
