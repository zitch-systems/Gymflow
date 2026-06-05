'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { markNotificationRead } from '@/lib/actions/notifications';
import {
  Bell, CalendarCheck, Gift, Receipt, Sparkles, type LucideIcon,
} from 'lucide-react';

export type InboxRow = {
  id: string;
  title: string;
  body: string | null;
  type: string | null;
  sent_at: string | null;
  is_read: boolean | null;
};

// Map notification.type values onto the prototype's five visual buckets
// (reminder/receipt/class/promo/system). Each bucket has its own icon
// chip color via .nic.<bucket> CSS.
type Bucket = 'reminder' | 'receipt' | 'class' | 'promo' | 'system';
const TYPE_BUCKET: Record<string, Bucket> = {
  reminder: 'reminder',
  class_reminder: 'reminder',
  expiry_reminder: 'reminder',
  payment: 'receipt',
  payout: 'receipt',
  receipt: 'receipt',
  class_booking: 'class',
  class_confirmed: 'class',
  class: 'class',
  promo: 'promo',
  referral: 'promo',
  announcement: 'system',
  system: 'system',
};
const BUCKET_ICON: Record<Bucket, LucideIcon> = {
  reminder: Bell,
  receipt: Receipt,
  class: CalendarCheck,
  promo: Gift,
  system: Sparkles,
};

const DAY_MS = 86_400_000;

function timeLabel(iso: string, now: Date): string {
  const sent = new Date(iso);
  const sameDay = sent.toDateString() === now.toDateString();
  if (sameDay) {
    return `Today · ${sent.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  }
  const diffDays = Math.floor((now.getTime() - sent.getTime()) / DAY_MS);
  if (diffDays < 7) {
    return `${sent.toLocaleDateString('en-NG', { weekday: 'short' })} · ${sent.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  }
  return sent.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
}

function bucketOf(row: InboxRow, now: Date): 'today' | 'week' | 'earlier' {
  if (!row.sent_at) return 'earlier';
  const sent = new Date(row.sent_at);
  if (sent.toDateString() === now.toDateString()) return 'today';
  if ((now.getTime() - sent.getTime()) < 7 * DAY_MS) return 'week';
  return 'earlier';
}

const BUCKET_LABEL: Record<'today' | 'week' | 'earlier', string> = {
  today: 'Today',
  week: 'This week',
  earlier: 'Earlier',
};

export function InboxList({ slug, rows }: { slug: string; rows: InboxRow[] }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const now = new Date();

  const groups: Record<'today' | 'week' | 'earlier', InboxRow[]> = { today: [], week: [], earlier: [] };
  for (const r of rows) groups[bucketOf(r, now)].push(r);

  return (
    <>
      {(['today', 'week', 'earlier'] as const).map((b) => {
        if (groups[b].length === 0) return null;
        return (
          <div key={b}>
            <div className="notif-group">{BUCKET_LABEL[b]}</div>
            {groups[b].map((r) => {
              const bucket = (r.type && TYPE_BUCKET[r.type]) || 'system';
              const Icon = BUCKET_ICON[bucket];
              const unread = !r.is_read;
              return (
                <button
                  key={r.id}
                  type="button"
                  className={`notif${unread ? ' unread' : ''}`}
                  disabled={pending}
                  onClick={() => {
                    if (!unread) return;
                    start(async () => {
                      await markNotificationRead(slug, r.id);
                      router.refresh();
                    });
                  }}
                >
                  <span className={`nic ${bucket}`} aria-hidden><Icon /></span>
                  <div className="m">
                    <strong>{r.title}</strong>
                    {r.body ? <p>{r.body}</p> : null}
                    {r.sent_at ? <span className="nt">{timeLabel(r.sent_at, now)}</span> : null}
                  </div>
                  {unread ? <span className="udot" aria-label="Unread" /> : null}
                </button>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
