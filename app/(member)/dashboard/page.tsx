import Link from 'next/link';
import {
  Bell, CreditCard, ScanLine, CalendarDays, Wallet, QrCode, Flame, Check,
  Activity, CalendarCheck, Timer, Bike, Gift,
} from 'lucide-react';

export const metadata = { title: 'Home' };

// Member home — recreates revamp/member.html "home" view: greeting header,
// membership status card, quick actions, weekly streak, stat trio, next
// class, refer promo, recent check-ins. Static prototype data (no backend yet).
const WEEK = [
  { d: 'M', done: true }, { d: 'T', done: true }, { d: 'W', done: true, today: true },
  { d: 'T', done: false }, { d: 'F', done: false }, { d: 'S', rest: true }, { d: 'S', rest: true },
];

export default function MemberHome() {
  return (
    <section className="view on" data-v="home">
      <div className="mhead">
        <span className="gf-avatar gf-avatar-md">T</span>
        <div><small>Powerhouse Fitness</small><strong>Hi, Tunde 👋</strong></div>
        <Link href="/dashboard/inbox" className="icon-btn bell" style={{ width: 38, height: 38 }} aria-label="Notifications">
          <Bell strokeWidth={1.9} /><span className="nub">3</span>
        </Link>
      </div>

      <div className="home-grid">
        <div className="col-a">
          <div className="status">
            <span className="tag"><span className="gf-dot" style={{ background: '#fff' }} /> Active</span>
            <div className="plan">Annual membership</div>
            <div className="meta">Renews 12 March 2027</div>
            <div className="barwrap"><div className="bar" /></div>
            <div className="days"><span>228 days used</span><span>137 days left</span></div>
            <Link href="/dashboard/wallet" className="status-cta"><CreditCard strokeWidth={2} /> Manage membership</Link>
          </div>

          <div className="qa">
            <Link href="/checkin"><span className="tile"><ScanLine strokeWidth={1.9} /></span><span>Check in</span></Link>
            <Link href="/classes"><span className="tile"><CalendarDays strokeWidth={1.9} /></span><span>Schedule</span></Link>
            <Link href="/dashboard/wallet"><span className="tile"><Wallet strokeWidth={1.9} /></span><span>Wallet</span></Link>
            <Link href="/checkin"><span className="tile"><QrCode strokeWidth={1.9} /></span><span>My code</span></Link>
          </div>

          <div className="week">
            <div className="week-top">
              <div className="week-streak">
                <span className="flame"><Flame strokeWidth={2} /></span>
                <div><b>5-day streak</b><small>Best: 9 days</small></div>
              </div>
              <div className="week-goal"><b>3/4</b><small>Weekly goal</small></div>
            </div>
            <div className="week-days">
              {WEEK.map((w, i) => (
                <div key={i} className={`wd${w.done ? ' done' : ''}${w.today ? ' today' : ''}${w.rest ? ' rest' : ''}`}>
                  <span>{w.d}</span>
                  <div className="dot"><Check strokeWidth={3} /></div>
                </div>
              ))}
            </div>
          </div>

          <div className="stat3">
            <div className="s"><Activity strokeWidth={1.9} /><b>14</b><small>Visits this month</small></div>
            <div className="s"><CalendarCheck strokeWidth={1.9} /><b>6</b><small>Classes booked</small></div>
            <div className="s"><Timer strokeWidth={1.9} /><b>52<span style={{ fontSize: '0.9rem' }}>m</span></b><small>Avg session</small></div>
          </div>
        </div>

        <div className="col-b">
          <div className="sect-t">Next class <Link href="/classes">See all</Link></div>
          <Link href="/classes" className="lc tap">
            <div className="ic"><Bike strokeWidth={1.9} /></div>
            <div className="m"><strong>Spin Class</strong><small>Coach Tobi · 17:30 today</small></div>
            <span className="gf-badge gf-badge-success">Booked</span>
          </Link>

          <div className="promo">
            <span className="pic"><Gift strokeWidth={1.9} /></span>
            <div className="m"><strong>Refer &amp; earn ₦5,000</strong><small>Invite a friend to Powerhouse.</small></div>
            <button className="pill">Invite</button>
          </div>

          <div className="sect-t">Recent check-ins</div>
          <div className="lc"><div className="ic"><Check strokeWidth={1.9} /></div><div className="m"><strong>Main entrance</strong><small>QR scan</small></div><span className="t">Today · 7:02</span></div>
          <div className="lc"><div className="ic"><Check strokeWidth={1.9} /></div><div className="m"><strong>Main entrance</strong><small>QR scan</small></div><span className="t">Wed · 6:58</span></div>
        </div>
      </div>
    </section>
  );
}
