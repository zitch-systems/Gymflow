import Link from 'next/link';
import { requireMember } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { signOut } from '@/lib/auth/actions';
import { daysLeft } from '@/lib/format';
import { daysAgoIso } from '@/lib/dates';
import { computeActivity } from '@/lib/activity';
import { SubscriptionActions } from '../subscription-actions';
import { InstallAppButton } from '@/lib/pwa-install';
import {
  CreditCard, Wallet, GraduationCap, Dumbbell, Bell, MessageSquare,
  Smartphone, LogOut, ChevronRight, Pencil,
} from 'lucide-react';

export const metadata = { title: 'Settings' };

type PageProps = { params: Promise<{ slug: string }> };

// notification_* columns ship in 20260529_member_notification_prefs.sql but may
// not exist on every preview branch's DB — read defensively.
type ProfileRow = {
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  photo_url: string | null;
  notification_email?: boolean | null;
  notification_whatsapp?: boolean | null;
};

export default async function MemberSettingsPage({ params }: PageProps) {
  const { slug } = await params;
  const { user, gym } = await requireMember(slug);

  const supabase = await createClient();
  const [{ data: p }, { data: subscription }, { data: checkIns }] = await Promise.all([
    supabase
      .from('profiles')
      .select('full_name, first_name, last_name, email, photo_url, notification_email, notification_whatsapp')
      .eq('id', user.id)
      .maybeSingle<ProfileRow>(),
    supabase
      .from('member_subscriptions')
      .select('end_date, status, auto_debit_enabled')
      .eq('member_id', user.id)
      .eq('gym_id', gym.id)
      .eq('status', 'active')
      .order('end_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('check_ins')
      .select('checked_in_at')
      .eq('member_id', user.id)
      .eq('gym_id', gym.id)
      .gte('checked_in_at', daysAgoIso(45))
      .order('checked_in_at', { ascending: false }),
  ]);
  const activity = computeActivity((checkIns ?? []).map((c) => c.checked_in_at));

  const displayName = p?.full_name ?? [p?.first_name, p?.last_name].filter(Boolean).join(' ') ?? p?.email ?? 'Member';
  const avatarInitial = (p?.full_name ?? p?.email ?? 'M').charAt(0).toUpperCase();
  const remaining = subscription?.end_date ? daysLeft(subscription.end_date) : 0;
  const isActive = remaining > 0;
  const notifEmail = p?.notification_email !== false;
  const notifWa = p?.notification_whatsapp !== false;
  const notifSummary = notifEmail && notifWa ? 'All on' : !notifEmail && !notifWa ? 'Off' : notifEmail ? 'Email' : 'WhatsApp';

  return (
    <div className="member-portal member-app">
      <header className="member-header">
        <div><h1 className="gf-page-title">Settings</h1></div>
      </header>

      {/* Profile header → personal details */}
      <Link href="/dashboard/profile/edit" className="gf-profile-card">
        <span className="gf-profile-av">
          {p?.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.photo_url} alt="" />
          ) : avatarInitial}
        </span>
        <span className="gf-profile-m">
          <strong>{displayName}</strong>
          <small>{p?.email ?? gym.name}</small>
        </span>
        <Pencil size={18} strokeWidth={1.75} className="gf-srow-chev" />
      </Link>

      <div className="m-pstats" aria-label="Your activity">
        <div className="m-pstat"><b>{activity.totalVisits}</b><small>Visits</small></div>
        <div className="m-pstat"><b>{activity.currentStreak}</b><small>Day streak</small></div>
        <div className="m-pstat"><b>{activity.visitsThisMonth}</b><small>This month</small></div>
      </div>

      <div className="gf-slist">
        <section className="gf-slist-sec" aria-label="Membership">
          <div className="gf-slist-title">Membership</div>
          <div className="gf-slist-group">
            <Link href="/dashboard/renew" className="gf-srow">
              <span className="gf-srow-ic"><CreditCard /></span>
              <span className="gf-srow-m">
                <strong>Renew membership</strong>
                <small>{isActive ? `${remaining} day${remaining === 1 ? '' : 's'} left` : 'Renew to start training'}</small>
              </span>
              {!isActive
                ? <span className="gf-srow-pill">Due</span>
                : <ChevronRight size={18} strokeWidth={1.9} className="gf-srow-chev" />}
            </Link>
          </div>
        </section>

        {subscription ? (
          <section className="gf-slist-sec" aria-label="Manage plan">
            <div className="gf-slist-title">Manage plan</div>
            <div className="gf-slist-group" style={{ padding: 16 }}>
              <SubscriptionActions
                slug={slug}
                status={subscription.status ?? 'active'}
                autoRenew={!!subscription.auto_debit_enabled}
              />
            </div>
          </section>
        ) : null}

        <section className="gf-slist-sec" aria-label="Payments and training">
          <div className="gf-slist-title">Payments &amp; training</div>
          <div className="gf-slist-group">
            <Link href="/dashboard/cards" className="gf-srow">
              <span className="gf-srow-ic"><Wallet /></span>
              <span className="gf-srow-m"><strong>Saved cards</strong><small>Manage payment methods</small></span>
              <ChevronRight size={18} strokeWidth={1.9} className="gf-srow-chev" />
            </Link>
            <Link href="/dashboard/instructors" className="gf-srow">
              <span className="gf-srow-ic"><GraduationCap /></span>
              <span className="gf-srow-m"><strong>Coaches</strong><small>Browse &amp; subscribe</small></span>
              <ChevronRight size={18} strokeWidth={1.9} className="gf-srow-chev" />
            </Link>
            <Link href="/dashboard/pt-packs" className="gf-srow">
              <span className="gf-srow-ic"><Dumbbell /></span>
              <span className="gf-srow-m"><strong>Personal training</strong><small>Buy &amp; track session packs</small></span>
              <ChevronRight size={18} strokeWidth={1.9} className="gf-srow-chev" />
            </Link>
          </div>
        </section>

        <section className="gf-slist-sec" aria-label="Account">
          <div className="gf-slist-title">Account</div>
          <div className="gf-slist-group">
            <Link href="/dashboard/inbox" className="gf-srow">
              <span className="gf-srow-ic"><MessageSquare /></span>
              <span className="gf-srow-m"><strong>Messages</strong><small>Announcements &amp; reminders</small></span>
              <ChevronRight size={18} strokeWidth={1.9} className="gf-srow-chev" />
            </Link>
            <Link href="/dashboard/profile/edit#notifications" className="gf-srow">
              <span className="gf-srow-ic"><Bell /></span>
              <span className="gf-srow-m"><strong>Notifications</strong><small>Email &amp; WhatsApp</small></span>
              <span className="gf-srow-val">{notifSummary}</span>
              <ChevronRight size={18} strokeWidth={1.9} className="gf-srow-chev" />
            </Link>
            <Link href="/dashboard/profile/edit" className="gf-srow">
              <span className="gf-srow-ic"><Pencil /></span>
              <span className="gf-srow-m"><strong>Personal details</strong><small>Phone &amp; profile photo</small></span>
              <ChevronRight size={18} strokeWidth={1.9} className="gf-srow-chev" />
            </Link>
          </div>
        </section>

        <section className="gf-slist-sec" aria-label="App">
          <div className="gf-slist-title">App</div>
          <div className="gf-slist-group" style={{ padding: 15, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
              <span className="gf-srow-ic"><Smartphone /></span>
              <span className="gf-srow-m"><strong>Install app</strong><small>Add {gym.name} to your home screen</small></span>
            </div>
            <InstallAppButton />
          </div>
        </section>

        <div className="gf-slist-group">
          <form action={signOut}>
            <button type="submit" className="gf-srow is-danger">
              <span className="gf-srow-ic"><LogOut /></span>
              <span className="gf-srow-m"><strong>Sign out</strong></span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
