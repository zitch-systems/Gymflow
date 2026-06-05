import { requireMember } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { markAllNotificationsRead } from '@/lib/actions/notifications';
import { EmptyState } from '@/components/ui/empty-state';
import { Bell, CheckCheck } from 'lucide-react';
import { InboxList, type InboxRow } from './inbox-list';

export const metadata = { title: 'Notifications' };

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
    .order('sent_at', { ascending: false })
    .limit(100);

  const rows = (data ?? []) as InboxRow[];
  const unreadCount = rows.filter((r) => !r.is_read).length;

  return (
    <div className="member-portal member-app">
      <header className="m-head" style={{ justifyContent: 'space-between', paddingBottom: 6 }}>
        <strong className="htitle">Notifications</strong>
        {unreadCount > 0 ? (
          <form action={markAllNotificationsRead.bind(null, slug)}>
            <button
              type="submit"
              className="m-head-bell"
              aria-label={`Mark all ${unreadCount} as read`}
              title="Mark all read"
            >
              <CheckCheck size={18} strokeWidth={1.9} />
            </button>
          </form>
        ) : (
          <span style={{ width: 38, height: 38 }} aria-hidden />
        )}
      </header>

      {rows.length > 0 ? (
        <InboxList slug={slug} rows={rows} />
      ) : (
        <EmptyState
          icon={Bell}
          title="No messages yet"
          message={`Announcements, payment receipts, and gym alerts from ${gym.name} will appear here.`}
        />
      )}
    </div>
  );
}
