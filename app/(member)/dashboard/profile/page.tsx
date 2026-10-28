import Link from 'next/link';
import { Wallet, QrCode, Bell, FileText, LifeBuoy, Settings, LogOut, ChevronRight, CalendarDays, UserRoundX, MessageCircle } from 'lucide-react';
import { signOut } from '@/lib/auth/actions';
import { ThemeToggleRow } from '@/components/theme-toggle';
import { FreezeRequest } from '@/components/member/freeze-request';
import { AutoRenewRow } from '@/components/member/auto-renew-row';
import { requireMember, getProfile } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Profile' };

// Profile — recreates revamp/member.html "profile": hero, lifetime stats,
// grouped menus. Identity + visit/class counts are wired to Supabase.
export default async function ProfilePage() {
  // Parallel — see app/(member)/dashboard/page.tsx.
  const [{ user, gym, link }, profile] = await Promise.all([requireMember(), getProfile()]);
  const supabase = await createClient();

  const results = await Promise.all([
    supabase.from('check_ins').select('id', { count: 'exact', head: true }).eq('member_id', user.id).eq('gym_id', gym.id),
    supabase.from('class_bookings').select('id', { count: 'exact', head: true }).eq('member_id', user.id).eq('gym_id', gym.id).eq('status', 'attended'),
    supabase.from('member_subscriptions').select('id, status, end_date, auto_debit_enabled, paystack_subscription_code').eq('member_id', user.id).eq('gym_id', gym.id)
      .in('status', ['active', 'pause_requested', 'paused', 'past_due']).order('end_date', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('is_read', false),
  ]);
  if (results.some((result) => result.error)) throw new Error('Your profile could not be loaded. Please try again.');
  const [{ count: visits }, { count: classes }, { data: sub }, { count: unread }] = results;
  const freezeStatus = sub?.status === 'active' || sub?.status === 'pause_requested' || sub?.status === 'paused' ? sub.status : null;
  const freezeEnabled = (gym as { member_freeze_enabled?: boolean }).member_freeze_enabled !== false;
  const subEndDate = sub?.end_date ?? null;
  const autoRenewSubId = sub && sub.auto_debit_enabled && sub.paystack_subscription_code ? sub.id : null;
  const whatsappUrl = `https://wa.me/${(process.env.WHATSAPP_BUSINESS_NUMBER ?? '2349169582776').replace(/\D/g, '')}?text=${encodeURIComponent(gym.member_code)}`;

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
          <div className="m"><strong>Wallet &amp; billing</strong><small>Membership, payments &amp; receipts</small></div>
          <ChevronRight className="chev" strokeWidth={1.9} />
        </Link>
        <Link href="/classes" className="row">
          <span className="ic"><CalendarDays strokeWidth={1.9} /></span>
          <div className="m"><strong>Classes &amp; bookings</strong><small>Browse the schedule and manage your spots</small></div>
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
          {(unread ?? 0) > 0 && <span className="gf-badge gf-badge-brand">{unread! > 99 ? '99+' : unread} new</span>}
          <ChevronRight className="chev" strokeWidth={1.9} />
        </Link>
      </div>

      <div className="group">
        <AutoRenewRow subId={autoRenewSubId} />
        <FreezeRequest status={freezeStatus} enabled={freezeEnabled} subEndDate={subEndDate} />
      </div>

      <div className="group">
        <ThemeToggleRow />
        <a href={whatsappUrl} className="row" target="_blank" rel="noopener noreferrer">
          <span className="ic"><MessageCircle strokeWidth={1.9} /></span>
          <div className="m"><strong>GymFlow on WhatsApp</strong><small>Open your gym assistant</small></div>
          <ChevronRight className="chev" strokeWidth={1.9} />
        </a>
        <Link href="/dashboard/documents" className="row">
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
        <Link href="/account/delete" className="row">
          <span className="ic"><UserRoundX strokeWidth={1.9} /></span>
          <div className="m"><strong>Delete account</strong><small>Review and request account deletion</small></div>
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
