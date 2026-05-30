import Link from 'next/link';
import { requireMember } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { signOut } from '@/lib/auth/actions';
import { fmtDate, daysLeft, firstName } from '@/lib/format';
import { Card, CardHeader } from '@/components/ui/card';
import { ProfileForm } from './profile-form';
import { CreditCard, Wallet, GraduationCap, LogOut, Dumbbell, ChevronRight } from 'lucide-react';

export const metadata = { title: 'Settings' };

type PageProps = { params: Promise<{ slug: string }> };

// The two notification-pref columns ship in the
// 20260529_member_notification_prefs.sql migration but may not exist yet in
// every preview branch's DB. Read defensively so the page still loads.
type ProfileRow = {
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  photo_url: string | null;
  notification_email?: boolean | null;
  notification_whatsapp?: boolean | null;
};

export default async function MemberProfilePage({ params }: PageProps) {
  const { slug } = await params;
  const { user, gym } = await requireMember(slug);

  const supabase = await createClient();
  const [{ data: p }, { data: subscription }] = await Promise.all([
    supabase
      .from('profiles')
      .select('full_name, first_name, last_name, email, phone, photo_url, notification_email, notification_whatsapp')
      .eq('id', user.id)
      .maybeSingle<ProfileRow>(),
    supabase
      .from('member_subscriptions')
      .select('start_date, end_date, status, membership_plans(name)')
      .eq('member_id', user.id)
      .eq('gym_id', gym.id)
      .eq('status', 'active')
      .order('end_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const displayName = p?.full_name
    ?? [p?.first_name, p?.last_name].filter(Boolean).join(' ')
    ?? p?.email
    ?? 'Member';
  const planRel = subscription?.membership_plans;
  const plan = Array.isArray(planRel) ? planRel[0] : planRel;
  const planName = plan?.name ?? 'No active plan';
  const remaining = subscription?.end_date ? daysLeft(subscription.end_date) : 0;
  const isActive = remaining > 0;
  // 14-day "Hot" threshold: nudge the member toward Renew before things lapse.
  const expiringSoon = isActive && remaining <= 14;
  const showRenewalBanner = !isActive || expiringSoon;

  return (
    <div className="member-portal member-app">
      {/* Hero — current membership status. Mirrors the dashboard hero so the
          two pages feel like the same product, not two flavours of "settings". */}
      <section className="m-status" aria-label="Membership status">
        <span className="m-status-tag">
          <span className="m-status-dot" aria-hidden />
          {isActive ? 'Active' : subscription ? 'Expired' : 'No membership'}
        </span>
        <div className="m-status-plan">
          {isActive ? `${remaining} day${remaining === 1 ? '' : 's'} left` : planName}
        </div>
        <div className="m-status-meta">
          {subscription?.end_date ? (isActive ? `Renews ${fmtDate(subscription.end_date)}` : `Expired ${fmtDate(subscription.end_date)}`) : 'Renew to start training'}
          {plan?.name && isActive ? ` · ${plan.name}` : ''}
        </div>
        {!isActive ? (
          <Link href="/dashboard/renew" className="gf-btn gf-btn-light gf-btn-sm m-status-renew">Renew membership</Link>
        ) : null}
      </section>

      {/* Quick actions — 5-up ring. The Sign out tile is a form-action button
          styled like the others; keeps the row symmetrical without bolting a
          card on at the bottom for one action. */}
      <section className="m-qa m-qa-5" aria-label="Profile shortcuts">
        <Link href="/dashboard/renew" className="m-qa-tile">
          <CreditCard size={20} strokeWidth={1.75} />
          <span>Renew</span>
          {expiringSoon ? <span className="m-qa-badge">Hot</span> : null}
        </Link>
        <Link href="/dashboard/cards" className="m-qa-tile">
          <Wallet size={20} strokeWidth={1.75} />
          <span>Cards</span>
        </Link>
        <Link href="/dashboard/instructors" className="m-qa-tile">
          <GraduationCap size={20} strokeWidth={1.75} />
          <span>Coaches</span>
        </Link>
        <Link href="/dashboard/pt-packs" className="m-qa-tile">
          <Dumbbell size={20} strokeWidth={1.75} />
          <span>PT packs</span>
        </Link>
        <form action={signOut} style={{ display: 'contents' }}>
          <button type="submit" className="m-qa-tile">
            <LogOut size={20} strokeWidth={1.75} />
            <span>Sign out</span>
          </button>
        </form>
      </section>

      {/* Conditional renewal nudge. The "real ask" shape of the OPay banner —
          only surfaces when there's actually something to do. */}
      {showRenewalBanner ? (
        <section className="profile-banner" aria-label="Renewal nudge">
          <div className="profile-banner-title">
            {isActive ? `${remaining} day${remaining === 1 ? '' : 's'} left on your ${plan?.name ?? 'membership'}` : 'Your membership has lapsed'}
          </div>
          <ul className="profile-banner-list">
            <li>Renew now to keep your check-ins and class bookings.</li>
            <li>Card on file? It&apos;ll renew in one tap.</li>
            <li>Pause if you&apos;re travelling — admin can help.</li>
          </ul>
          <Link href="/dashboard/renew" className="gf-btn gf-btn-light gf-btn-sm profile-banner-cta">
            Renew now <ChevronRight size={14} strokeWidth={2} />
          </Link>
        </section>
      ) : null}

      {/* 2-up summary cards. Account snapshot is read-only on purpose — name
          and email are identity-bearing and changing them goes through admin
          / support. The Notifications card deep-links to the form below. */}
      <section className="profile-pair" aria-label="Account summary">
        <div className="profile-pair-card">
          <h3>Account</h3>
          <p style={{ fontWeight: 600, color: 'var(--gf-text)' }}>{displayName}</p>
          <p>{p?.email ?? '—'}</p>
          <p style={{ marginTop: 'auto', fontSize: '0.72rem', color: 'var(--gf-text-muted)' }}>
            Ask gym admin to change your name or email.
          </p>
        </div>
        <div className="profile-pair-card">
          <h3>Notifications</h3>
          <p>{p?.notification_email !== false ? 'Email on' : 'Email off'} · {p?.notification_whatsapp !== false ? 'WhatsApp on' : 'WhatsApp off'}</p>
          <p>{firstName(p?.full_name)}, manage how the gym reaches you.</p>
          <Link href="#notifications" className="gf-btn gf-btn-ghost gf-btn-sm">Manage</Link>
        </div>
      </section>

      <Card>
        <CardHeader title="Edit profile" />
        <div id="notifications" style={{ padding: 18 }}>
          <ProfileForm
            slug={slug}
            userId={user.id}
            email={p?.email ?? user.email ?? null}
            displayName={displayName}
            initial={{
              phone: p?.phone ?? null,
              photo_url: p?.photo_url ?? null,
              // Default to opted-in (matches the column default) if the
              // migration hasn't been applied yet for this gym's DB.
              notification_email: p?.notification_email ?? true,
              notification_whatsapp: p?.notification_whatsapp ?? true,
            }}
          />
        </div>
      </Card>
    </div>
  );
}
