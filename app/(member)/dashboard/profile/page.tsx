import Link from 'next/link';
import { Wallet, QrCode, Bell, FileText, LifeBuoy, Settings, LogOut, ChevronRight } from 'lucide-react';
import { signOut } from '@/lib/auth/actions';

export const metadata = { title: 'Profile' };

// Profile — recreates revamp/member.html "profile": hero, lifetime stats,
// and three grouped menus (account / support / sign out). Static data.
export default function ProfilePage() {
  return (
    <section className="view on" data-v="profile">
      <div className="prof-top">
        <span className="gf-avatar gf-avatar-xl">T</span>
        <h2>Tunde Adeyemi</h2>
        <p>Member since Jan 2024 · Powerhouse Fitness</p>
      </div>

      <div className="prof-stats">
        <div className="ps"><b>142</b><small>Visits</small></div>
        <div className="ps"><b>5</b><small>Day streak</small></div>
        <div className="ps"><b>38</b><small>Classes</small></div>
      </div>

      <div className="group">
        <Link href="/dashboard/wallet" className="row">
          <span className="ic"><Wallet strokeWidth={1.9} /></span>
          <div className="m"><strong>Wallet &amp; billing</strong><small>₦4,500 · Annual plan</small></div>
          <ChevronRight className="chev" strokeWidth={1.9} />
        </Link>
        <Link href="/checkin" className="row">
          <span className="ic"><QrCode strokeWidth={1.9} /></span>
          <div className="m"><strong>My check-in code</strong><small>Show at the door</small></div>
          <ChevronRight className="chev" strokeWidth={1.9} />
        </Link>
        <Link href="/dashboard/inbox" className="row">
          <span className="ic"><Bell strokeWidth={1.9} /></span>
          <div className="m"><strong>Notifications</strong><small>Reminders &amp; receipts</small></div>
          <span className="gf-badge gf-badge-brand">3 new</span>
          <ChevronRight className="chev" strokeWidth={1.9} />
        </Link>
      </div>

      <div className="group">
        <Link href="/legal#waiver" className="row">
          <span className="ic"><FileText strokeWidth={1.9} /></span>
          <div className="m"><strong>Waiver &amp; documents</strong></div>
          <ChevronRight className="chev" strokeWidth={1.9} />
        </Link>
        <a href="mailto:hello@gymflow.ng" className="row">
          <span className="ic"><LifeBuoy strokeWidth={1.9} /></span>
          <div className="m"><strong>Help &amp; support</strong></div>
          <ChevronRight className="chev" strokeWidth={1.9} />
        </a>
        <div className="row">
          <span className="ic"><Settings strokeWidth={1.9} /></span>
          <div className="m"><strong>Settings</strong></div>
          <ChevronRight className="chev" strokeWidth={1.9} />
        </div>
      </div>

      <div className="group">
        <form action={signOut}>
          <button type="submit" className="row" style={{ color: 'var(--gf-danger)', width: '100%', background: 'none', border: 'none', cursor: 'pointer' }}>
            <span className="ic" style={{ background: 'var(--gf-danger-soft)', color: 'var(--gf-danger)' }}><LogOut strokeWidth={1.9} /></span>
            <div className="m"><strong style={{ color: 'var(--gf-danger)' }}>Sign out</strong></div>
            <ChevronRight className="chev" strokeWidth={1.9} />
          </button>
        </form>
      </div>
    </section>
  );
}
