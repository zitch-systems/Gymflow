import Link from 'next/link';
import { Wallet, QrCode, Bell, FileText, LifeBuoy, Settings, LogOut, ChevronRight } from 'lucide-react';
import { signOut } from '@/lib/auth/actions';
import { ThemeToggleRow } from '@/components/theme-toggle';
import { requireMember, getProfile } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Profile' };

// Profile — recreates revamp/member.html "profile": hero, lifetime stats,
// grouped menus. Identity + visit/class counts are wired to Supabase.
export default async function ProfilePage() {
  const { user, gym, link } = await requireMember();
  const profile = await getProfile();
  const supabase = await createClient();

  const [{ count: visits }, { count: classes }] = await Promise.all([
    supabase.from('check_ins').select('id', { count: 'exact', head: true }).eq('member_id', user.id).eq('gym_id', gym.id),
    supabase.from('class_bookings').select('id', { count: 'exact', head: true }).eq('member_id', user.id).eq('gym_id', gym.id).eq('status', 'attended'),
  ]);

  const name = profile?.full_name || [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || profile?.email || 'Member';
  const initial = name.charAt(0).toUpperCase();
  const joined = link.joined_at ? new Date(link.joined_at).toLocaleDateString('en-NG', { month: 'short', year: 'numeric' }) : null;

  return (
    <section className="view on" data-v="profile">
      <div className="prof-top">
        <span className="gf-avatar gf-avatar-xl">{initial}</span>
        <h2>{name}</h2>
        <p>{joined ? `Member since ${joined} · ${gym.name}` : gym.name}</p>
      </div>

      <div className="prof-stats">
        <div className="ps"><b>{visits ?? 0}</b><small>Visits</small></div>
        <div className="ps"><b>{classes ?? 0}</b><small>Classes</small></div>
        <div className="ps"><b>{gym.name.split(' ')[0]}</b><small>Gym</small></div>
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
        <ThemeToggleRow />
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
        <Link href="/dashboard/profile/edit" className="row">
          <span className="ic"><Settings strokeWidth={1.9} /></span>
          <div className="m"><strong>Edit profile</strong></div>
          <ChevronRight className="chev" strokeWidth={1.9} />
        </Link>
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
