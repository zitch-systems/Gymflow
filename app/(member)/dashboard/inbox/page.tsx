import Link from 'next/link';
import { ArrowLeft, CheckCheck, Bike, CalendarCheck, Gift, Receipt, Sparkles, Bell } from 'lucide-react';

export const metadata = { title: 'Notifications' };

type Notif = {
  nic: 'reminder' | 'class' | 'promo' | 'receipt' | 'system';
  icon: React.ReactNode; title: string; body: string; time: string; unread?: boolean;
  href?: string; btn?: string;
};

const GROUPS: { label: string; items: Notif[] }[] = [
  {
    label: 'Today',
    items: [
      { nic: 'reminder', icon: <Bike strokeWidth={1.9} />, title: 'Spin Class at 17:30', body: 'Your class with Coach Tobi starts in 2 hours. See you there.', time: 'Today · 15:30', unread: true, href: '/classes' },
      { nic: 'class', icon: <CalendarCheck strokeWidth={1.9} />, title: 'Yoga Flow confirmed', body: "You're booked for Fri 13 · 19:00 with Coach Ada.", time: 'Today · 11:08', unread: true, href: '/classes' },
    ],
  },
  {
    label: 'This week',
    items: [
      { nic: 'promo', icon: <Gift strokeWidth={1.9} />, title: 'Refer & earn ₦5,000', body: 'Invite a friend to Powerhouse and you both get ₦5,000 in wallet credit.', time: 'Mon · 09:00', unread: true, btn: 'Invite a friend' },
      { nic: 'receipt', icon: <Receipt strokeWidth={1.9} />, title: 'Payment successful', body: '₦37,999 for your Quarterly renewal. Tap to view the receipt.', time: 'Sun · 09:14', href: '/dashboard/wallet' },
    ],
  },
  {
    label: 'Earlier',
    items: [
      { nic: 'system', icon: <Sparkles strokeWidth={1.9} />, title: 'New class: Boxing Conditioning', body: 'Thursdays at 18:00 with Coach Tobi. Spots are open now.', time: '28 Nov', href: '/classes' },
      { nic: 'reminder', icon: <Bell strokeWidth={1.9} />, title: 'Membership renews in 137 days', body: "Auto-debit is on. We'll charge your saved card on 12 Mar.", time: '20 Nov', href: '/dashboard/wallet' },
    ],
  },
];

// Notifications — recreates revamp/member.html "notifications": grouped feed
// with type-tinted icons + unread dots. Static data.
export default function InboxPage() {
  return (
    <section className="view on" data-v="notifications">
      <div className="mhead" style={{ justifyContent: 'space-between', paddingBottom: 6 }}>
        <Link href="/dashboard" className="icon-btn" style={{ width: 34, height: 34 }} aria-label="Back"><ArrowLeft strokeWidth={1.9} /></Link>
        <strong className="htitle">Notifications</strong>
        <button className="icon-btn" style={{ width: 34, height: 34 }} title="Mark all read" aria-label="Mark all read"><CheckCheck strokeWidth={1.9} /></button>
      </div>

      {GROUPS.map((g) => (
        <div key={g.label}>
          <div className="notif-group">{g.label}</div>
          {g.items.map((n, i) => {
            const inner = (
              <>
                <span className={`nic ${n.nic}`}>{n.icon}</span>
                <div className="m">
                  <strong>{n.title}</strong>
                  <p>{n.body}</p>
                  <span className="nt">{n.time}</span>
                  {n.btn && <button className="gf-btn gf-btn-outline gf-btn-sm nbtn">{n.btn}</button>}
                </div>
                {n.unread && <span className="udot" />}
              </>
            );
            return n.href ? (
              <Link key={i} href={n.href} className={`notif${n.unread ? ' unread' : ''}`} style={{ textDecoration: 'none', color: 'inherit' }}>{inner}</Link>
            ) : (
              <div key={i} className={`notif${n.unread ? ' unread' : ''}`}>{inner}</div>
            );
          })}
        </div>
      ))}
    </section>
  );
}
