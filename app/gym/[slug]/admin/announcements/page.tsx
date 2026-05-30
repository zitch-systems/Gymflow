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

  // Active members (the recipient universe) + a digest of recent broadcasts.
  // We fetch the active user_ids rather than a head count because the tag
  // dropdown must count tags against *active* members only — member_tags rows
  // persist after a member goes inactive (no status cascade), so counting raw
  // tag rows would over-promise a reach the send can't deliver.
  const [{ data: activeLinks }, { data: notifs }, { data: tagRowsRaw }] = await Promise.all([
    admin
      .from('gym_member_links')
      .select('user_id')
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
    // Tag rows at this gym (with the owning user_id so we can intersect with
    // active members). The member_tags table isn't in the generated types yet
    // (migration 20260530_member_tags_and_notes.sql); cast through never.
    admin
      .from('member_tags' as never)
      .select('user_id, tag')
      .eq('gym_id' as never, gym.id),
  ]);

  const activeIds = new Set(((activeLinks ?? []) as Array<{ user_id: string | null }>).map((r) => r.user_id));
  const memberCount = activeIds.size;

  // Distinct, sorted tag list with a per-tag ACTIVE-member count, so the
  // dropdown shows "VIP (3)" and never lists a tag whose members have all
  // gone inactive (which would error on send).
  const tagRows = (tagRowsRaw ?? []) as unknown as Array<{ user_id: string; tag: string }>;
  const tagCounts = new Map<string, number>();
  for (const t of tagRows) {
    if (!activeIds.has(t.user_id)) continue;
    tagCounts.set(t.tag, (tagCounts.get(t.tag) ?? 0) + 1);
  }
  const tagOptions = [...tagCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag));

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
        <AnnouncementForm slug={slug} memberCount={memberCount} tagOptions={tagOptions} />
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
