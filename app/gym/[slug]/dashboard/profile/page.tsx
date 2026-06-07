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
    <div className="ds-member">
      <div className="view on" data-v="profile">
        {/* ── Profile hero ── */}
        <div className="prof-top">
          <span className="gf-avatar gf-avatar-xl">{avatarInitial}</span>
          <h2>{displayName}</h2>
          <p>{joinedLabel ? `Member since ${joinedLabel} · ${gym.name}` : gym.name}</p>
        </div>

        {/* ── Lifetime stats ── */}
        <div className="prof-stats" aria-label="Your activity">
          <div className="ps"><b>{visitsTotal}</b><small>Visits</small></div>
          <div className="ps"><b>{activity.currentStreak}</b><small>Day streak</small></div>
          <div className="ps"><b>{classesAttended}</b><small>Classes</small></div>
        </div>

        {/* ── Account group ── */}
        <div className="group">
          <Link href="/dashboard/wallet" className="row">
            <span className="ic"><Wallet /></span>
            <div className="m"><strong>Wallet &amp; billing</strong><small>Plan, payments &amp; receipts</small></div>
            <ChevronRight className="chev" strokeWidth={1.9} />
          </Link>
          <Link href="/checkin" className="row">
            <span className="ic"><QrCode /></span>
            <div className="m"><strong>My check-in code</strong><small>Show at the door</small></div>
            <ChevronRight className="chev" strokeWidth={1.9} />
          </Link>
          <Link href="/dashboard/inbox" className="row">
            <span className="ic"><Bell /></span>
            <div className="m"><strong>Notifications</strong><small>Reminders &amp; receipts</small></div>
            {unreadCount > 0 ? <span className="gf-badge gf-badge-brand">{unreadCount} new</span> : null}
            <ChevronRight className="chev" strokeWidth={1.9} />
          </Link>
        </div>

        {/* ── Support group ── */}
        <div className="group">
          <Link href="/legal#waiver" className="row">
            <span className="ic"><FileText /></span>
            <div className="m"><strong>Waiver &amp; documents</strong></div>
            <ChevronRight className="chev" strokeWidth={1.9} />
          </Link>
          <a href="mailto:hello@gymflow.ng?subject=GymFlow%20member%20support" className="row">
            <span className="ic"><LifeBuoy /></span>
            <div className="m"><strong>Help &amp; support</strong><small>hello@gymflow.ng</small></div>
            <ChevronRight className="chev" strokeWidth={1.9} />
          </a>
          <Link href="/dashboard/cards" className="row">
            <span className="ic"><Settings /></span>
            <div className="m"><strong>Saved cards &amp; settings</strong></div>
            <ChevronRight className="chev" strokeWidth={1.9} />
          </Link>
        </div>

        {/* ── Sign out ── */}
        <div className="group">
          <form action={signOut}>
            <button type="submit" className="row" style={{ width: '100%', color: 'var(--gf-danger)' }}>
              <span className="ic" style={{ background: 'var(--gf-danger-soft)', color: 'var(--gf-danger)' }}><LogOut /></span>
              <div className="m"><strong style={{ color: 'var(--gf-danger)' }}>Sign out</strong></div>
              <ChevronRight className="chev" strokeWidth={1.9} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
