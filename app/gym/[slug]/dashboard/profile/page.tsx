import Link from 'next/link';
import { requireMember } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { signOut } from '@/lib/auth/actions';
import { daysAgoIso } from '@/lib/dates';
import { computeActivity } from '@/lib/activity';
import {
  Wallet, QrCode, Bell, FileText, LifeBuoy, Settings, LogOut, ChevronRight,
} from 'lucide-react';

export const metadata = { title: 'Profile' };

type PageProps = { params: Promise<{ slug: string }> };

export default async function MemberProfilePage({ params }: PageProps) {
  const { slug } = await params;
  const { user, gym, link } = await requireMember(slug);

  const supabase = await createClient();
  const [profileRes, recentRes, lifetimeRes, attendedRes, unreadRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('full_name, first_name, last_name, email')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('check_ins')
      .select('checked_in_at')
      .eq('member_id', user.id)
      .eq('gym_id', gym.id)
      .gte('checked_in_at', daysAgoIso(45))
      .order('checked_in_at', { ascending: false }),
    supabase
      .from('check_ins')
      .select('id', { count: 'exact', head: true })
      .eq('member_id', user.id)
      .eq('gym_id', gym.id),
    supabase
      .from('class_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('member_id', user.id)
      .eq('gym_id', gym.id)
      .eq('status', 'attended'),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('gym_id', gym.id)
      .eq('is_read', false),
  ]);

  const p = profileRes.data;
  const activity = computeActivity((recentRes.data ?? []).map((c) => c.checked_in_at));
  const visitsTotal = lifetimeRes.count ?? 0;
  const classesAttended = attendedRes.count ?? 0;
  const unreadCount = unreadRes.count ?? 0;

  const composedName = [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim();
  const displayName = p?.full_name || composedName || p?.email || 'Member';
  const avatarInitial = displayName.charAt(0).toUpperCase();

  const joinedLabel = link.joined_at
    ? new Date(link.joined_at).toLocaleDateString('en-NG', { month: 'short', year: 'numeric' })
    : null;

  return (
    <div className="op-mobile member-portal member-app m-profile">
      <div className="m-prof-top">
        <span className="gf-avatar gf-avatar-xl">{avatarInitial}</span>
        <h2>{displayName}</h2>
        <p>{joinedLabel ? `Member since ${joinedLabel} · ${gym.name}` : gym.name}</p>
      </div>

      <div className="m-pstats" aria-label="Your activity">
        <div className="m-pstat"><b>{visitsTotal}</b><small>Visits</small></div>
        <div className="m-pstat"><b>{activity.currentStreak}</b><small>Day streak</small></div>
        <div className="m-pstat"><b>{classesAttended}</b><small>Classes</small></div>
      </div>

      <div className="m-prof-group">
        <Link href="/dashboard/wallet" className="m-prof-row">
          <span className="m-prof-row-ic"><Wallet /></span>
          <div className="m-prof-row-m">
            <strong>Wallet &amp; billing</strong>
            <small>Plan, payments &amp; receipts</small>
          </div>
          <ChevronRight className="m-prof-row-chev" strokeWidth={1.9} />
        </Link>
        <Link href="/checkin" className="m-prof-row">
          <span className="m-prof-row-ic"><QrCode /></span>
          <div className="m-prof-row-m">
            <strong>My check-in code</strong>
            <small>Show at the door</small>
          </div>
          <ChevronRight className="m-prof-row-chev" strokeWidth={1.9} />
        </Link>
        <Link href="/dashboard/inbox" className="m-prof-row">
          <span className="m-prof-row-ic"><Bell /></span>
          <div className="m-prof-row-m">
            <strong>Notifications</strong>
            <small>Reminders &amp; receipts</small>
          </div>
          {unreadCount > 0 ? (
            <span className="gf-badge gf-badge-brand">{unreadCount} new</span>
          ) : null}
          <ChevronRight className="m-prof-row-chev" strokeWidth={1.9} />
        </Link>
      </div>

      <div className="m-prof-group">
        <Link href="/legal#waiver" className="m-prof-row">
          <span className="m-prof-row-ic"><FileText /></span>
          <div className="m-prof-row-m"><strong>Waiver &amp; documents</strong></div>
          <ChevronRight className="m-prof-row-chev" strokeWidth={1.9} />
        </Link>
        <a href="mailto:hello@gymflow.ng?subject=GymFlow%20member%20support" className="m-prof-row">
          <span className="m-prof-row-ic"><LifeBuoy /></span>
          <div className="m-prof-row-m"><strong>Help &amp; support</strong><small>hello@gymflow.ng</small></div>
          <ChevronRight className="m-prof-row-chev" strokeWidth={1.9} />
        </a>
        <Link href="/dashboard/cards" className="m-prof-row">
          <span className="m-prof-row-ic"><Settings /></span>
          <div className="m-prof-row-m"><strong>Saved cards &amp; settings</strong></div>
          <ChevronRight className="m-prof-row-chev" strokeWidth={1.9} />
        </Link>
      </div>

      <div className="m-prof-group">
        <form action={signOut}>
          <button type="submit" className="m-prof-row is-danger">
            <span className="m-prof-row-ic"><LogOut /></span>
            <div className="m-prof-row-m"><strong>Sign out</strong></div>
            <ChevronRight className="m-prof-row-chev" strokeWidth={1.9} />
          </button>
        </form>
      </div>
    </div>
  );
}
