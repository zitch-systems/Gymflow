import { requireMember } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { EmptyState } from '@/components/ui/empty-state';
import { Card, CardHeader } from '@/components/ui/card';
import { Bell } from 'lucide-react';
import { InboxList, type InboxRow } from './inbox-list';
import { PushToggle } from './push-toggle';

export const metadata = { title: 'Inbox' };

type PageProps = { params: Promise<{ slug: string }> };

export default async function MemberInboxPage({ params }: PageProps) {
  const { slug } = await params;
  const { user, gym } = await requireMember(slug);
  const supabase = await createClient();

  // notif_select_self_or_gym (baseline RLS) restricts to user_id = auth.uid()
  // for member callers, so an explicit .eq() is belt-and-braces — the query
  // would scope itself anyway, but the filter also lets the planner use
  // idx_notifications_user_id_sent_at if it exists.
  const { data } = await supabase
    .from('notifications')
    .select('id, title, body, type, sent_at, is_read')
    .eq('user_id', user.id)
    .eq('gym_id', gym.id)
    .order('is_read', { ascending: true })   // unread first
    .order('sent_at', { ascending: false })
    .limit(100);

  const rows = (data ?? []) as InboxRow[];
  const unreadCount = rows.filter((r) => !r.is_read).length;

  return (
    <div className="member-portal member-app">
      <header className="member-header">
        <div>
          <h1 className="gf-page-title">Inbox</h1>
          <p className="gf-page-subtitle">
            {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'} · {gym.name}
          </p>
        </div>
        <PushToggle gymId={gym.id} />
      </header>

      <Card>
        <CardHeader title="Messages" />
        <div style={{ padding: 14 }}>
          {rows.length > 0 ? (
            <InboxList slug={slug} rows={rows} />
          ) : (
            <EmptyState
              icon={Bell}
              title="No messages yet"
              message="Announcements, payment receipts, and gym alerts will appear here."
            />
          )}
        </div>
      </Card>
    </div>
  );
}
