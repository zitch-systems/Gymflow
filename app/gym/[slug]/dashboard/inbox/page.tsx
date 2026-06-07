import Link from 'next/link';
import { requireMember } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { markAllNotificationsRead } from '@/lib/actions/notifications';
import { EmptyState } from '@/components/ui/empty-state';
import { ArrowLeft, Bell, CheckCheck } from 'lucide-react';
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
    <div className="ds-member">
      <div className="view on" data-v="notifications">
        <div className="mhead" style={{ justifyContent: 'space-between', paddingBottom: 6 }}>
          <Link href="/dashboard" className="icon-btn" style={{ width: 34, height: 34 }} aria-label="Back">
            <ArrowLeft strokeWidth={1.9} />
          </Link>
          <strong className="htitle">Notifications</strong>
          {unreadCount > 0 ? (
            <form action={markAllNotificationsRead.bind(null, slug)}>
              <button
                type="submit"
                className="icon-btn"
                style={{ width: 34, height: 34 }}
                aria-label={`Mark all ${unreadCount} as read`}
                title="Mark all read"
              >
                <CheckCheck strokeWidth={1.9} />
              </button>
            </form>
          ) : (
            <span style={{ width: 34, height: 34 }} aria-hidden />
          )}
        </div>

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
    </div>
  );
}
