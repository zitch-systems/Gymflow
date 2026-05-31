'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { markNotificationRead, markAllNotificationsRead } from '@/lib/actions/notifications';
import { fmtDateTime, relativeTime } from '@/lib/format';
import { Megaphone, CreditCard, Wallet, Bell } from 'lucide-react';

export type InboxRow = {
  id: string;
  title: string;
  body: string | null;
  type: string | null;
  sent_at: string | null;
  is_read: boolean | null;
};

// Map the notification.type values written across the app onto a small,
// consistent icon set. Unknown types fall back to a generic bell.
const TYPE_ICON: Record<string, typeof Megaphone> = {
  announcement: Megaphone,
  payment: CreditCard,
  payout: Wallet,
};

export function InboxList({ slug, rows }: { slug: string; rows: InboxRow[] }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const unreadCount = rows.filter((r) => !r.is_read).length;

  return (
    <>
      {unreadCount > 0 ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button
            type="button"
            className="gf-btn gf-btn-ghost gf-btn-sm"
            disabled={pending}
            onClick={() => start(async () => { await markAllNotificationsRead(slug); router.refresh(); })}
          >
            {pending ? 'Marking…' : `Mark all read (${unreadCount})`}
          </button>
        </div>
      ) : null}

      <ul className="m-links">
        {rows.map((r) => {
          const Icon = (r.type && TYPE_ICON[r.type]) || Bell;
          const unread = !r.is_read;
          return (
            <li
              key={r.id}
              className="m-lc"
              style={{
                cursor: unread ? 'pointer' : 'default',
                borderColor: unread ? 'var(--gf-brand)' : undefined,
                background: unread ? 'var(--gf-brand-soft)' : undefined,
              }}
              onClick={unread ? () => start(async () => { await markNotificationRead(slug, r.id); router.refresh(); }) : undefined}
            >
              <span className="m-lc-ic" aria-hidden>
                <Icon size={18} strokeWidth={1.75} />
              </span>
              <div className="m-lc-m">
                <strong>
                  {r.title}
                  {unread ? (
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gf-brand)', display: 'inline-block' }} aria-label="Unread" />
                  ) : null}
                </strong>
                {r.body ? (
                  <small style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {r.body}
                  </small>
                ) : null}
                <small style={{ marginTop: 4 }} title={r.sent_at ? fmtDateTime(r.sent_at) : ''}>
                  {r.sent_at ? relativeTime(r.sent_at) : ''}
                </small>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
