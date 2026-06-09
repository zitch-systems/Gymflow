import Link from 'next/link';
import { ArrowLeft, CheckCheck, Bell, CalendarCheck, Gift, Receipt, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { requireMember } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { markAllRead } from '@/lib/actions/notifications';

export const metadata = { title: 'Notifications' };

// Map notification.type → the prototype's 5 visual buckets (icon + .nic tint).
type Bucket = 'reminder' | 'class' | 'promo' | 'receipt' | 'system';
const BUCKET: Record<string, Bucket> = {
  reminder: 'reminder', class_reminder: 'reminder', expiry_reminder: 'reminder',
  class: 'class', class_booking: 'class', class_confirmed: 'class',
  promo: 'promo', referral: 'promo',
  payment: 'receipt', receipt: 'receipt', payout: 'receipt',
  announcement: 'system', system: 'system',
};
const ICON: Record<Bucket, LucideIcon> = { reminder: Bell, class: CalendarCheck, promo: Gift, receipt: Receipt, system: Sparkles };

const DAY = 86_400_000;
function bucketOf(iso: string | null, now: number): 'Today' | 'This week' | 'Earlier' {
  if (!iso) return 'Earlier';
  const t = new Date(iso).getTime();
  if (new Date(t).toDateString() === new Date(now).toDateString()) return 'Today';
  if (now - t < 7 * DAY) return 'This week';
  return 'Earlier';
}
function timeLabel(iso: string | null, now: number): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (d.toDateString() === new Date(now).toDateString()) return `Today · ${d.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  if (now - d.getTime() < 7 * DAY) return `${d.toLocaleDateString('en-NG', { weekday: 'short' })} · ${d.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
}

// Notifications — recreates revamp/member.html "notifications", wired to the
// user's notifications (RLS-scoped). Grouped Today / This week / Earlier.
export default async function InboxPage() {
  const { user } = await requireMember();
  const supabase = await createClient();
  const { data } = await supabase
    .from('notifications')
    .select('id, title, body, type, sent_at, is_read')
    .eq('user_id', user.id)
    .order('sent_at', { ascending: false })
    .limit(50);

  const now = Date.now();
  const rows = data ?? [];
  const groups: Record<string, typeof rows> = { Today: [], 'This week': [], Earlier: [] };
  for (const r of rows) groups[bucketOf(r.sent_at, now)].push(r);

  return (
    <section className="view on" data-v="notifications">
      <div className="mhead" style={{ justifyContent: 'space-between', paddingBottom: 6 }}>
        <Link href="/dashboard" className="icon-btn" style={{ width: 34, height: 34 }} aria-label="Back"><ArrowLeft strokeWidth={1.9} /></Link>
        <strong className="htitle">Notifications</strong>
        <form action={markAllRead}>
          <button className="icon-btn" style={{ width: 34, height: 34 }} title="Mark all read" aria-label="Mark all read"><CheckCheck strokeWidth={1.9} /></button>
        </form>
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          <div className="eic"><Bell strokeWidth={1.6} /></div>
          <h3>No messages yet</h3>
          <p>Reminders, receipts and gym alerts will appear here.</p>
        </div>
      ) : (
        (['Today', 'This week', 'Earlier'] as const).map((label) =>
          groups[label].length === 0 ? null : (
            <div key={label}>
              <div className="notif-group">{label}</div>
              {groups[label].map((n) => {
                const bucket = (n.type && BUCKET[n.type]) || 'system';
                const Icon = ICON[bucket];
                const unread = !n.is_read;
                return (
                  <div key={n.id} className={`notif${unread ? ' unread' : ''}`}>
                    <span className={`nic ${bucket}`}><Icon strokeWidth={1.9} /></span>
                    <div className="m">
                      <strong>{n.title}</strong>
                      {n.body && <p>{n.body}</p>}
                      <span className="nt">{timeLabel(n.sent_at, now)}</span>
                    </div>
                    {unread && <span className="udot" />}
                  </div>
                );
              })}
            </div>
          ),
        )
      )}
    </section>
  );
}
