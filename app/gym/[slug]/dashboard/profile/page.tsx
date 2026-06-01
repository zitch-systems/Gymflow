import Link from 'next/link';
import { requireMember } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { signOut } from '@/lib/auth/actions';
import { fmtDate, daysLeft, firstName } from '@/lib/format';
import { Card, CardHeader } from '@/components/ui/card';
import { ProfileForm } from './profile-form';
import { SubscriptionActions } from '../subscription-actions';
import { InstallAppButton } from '@/lib/pwa-install';
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
      .select('start_date, end_date, status, auto_debit_enabled, membership_plans:plan_id(name)')
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
  const remaining = subscription?.end_date ? daysLeft(subscription.end_date) : 0;
  const isActive = remaining > 0;
  // 14-day "Hot" threshold: nudge the member toward Renew before things lapse.
  const expiringSoon = isActive && remaining <= 14;
  const showRenewalBanner = !isActive || expiringSoon;

  return (
    <div className="member-portal member-app">
      <header className="member-header">
        <div>
          <h1 className="gf-page-title">Settings</h1>
          <p className="gf-page-subtitle">{displayName} · {gym.name}</p>
        </div>
      </header>

      {/* Hero — current membership status. Mirrors the dashboard hero so the
          two pages feel like the same product, not two flavours of "settings". */}
      <section className="m-status" aria-label="Membership status">
        <span className="m-status-tag">
          <span className="m-status-dot" aria-hidden />
          {isActive ? 'Active' : subscription ? 'Expired' : 'No membership'}
        </span>
        <div className="m-status-plan">
          {isActive
            ? `${remaining} day${remaining === 1 ? '' : 's'} left`
            : subscription
              ? 'Membership expired'
              : 'No active membership'}
        </div>
        <div className="m-status-meta">
          {subscription?.end_date ? (isActive ? `Renews ${fmtDate(subscription.end_date)}` : `Expired ${fmtDate(subscription.end_date)}`) : 'Renew to start training'}
          {plan?.name && isActive ? ` · ${plan.name}` : ''}
        </div>
        {!isActive ? (
          <Link href="/dashboard/renew" className="gf-btn gf-btn-light gf-btn-sm m-status-renew">Renew membership</Link>
        ) : null}
      </section>

      {/* Quick actions — 4-up navigation ring. Sign out is deliberately NOT
          here: it's destructive and confirmation-free, so it lives in a
          discrete footer rather than as a peer tap target among nav tiles. */}
      <section className="m-qa m-qa-4" aria-label="Profile shortcuts">
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
      </section>

      {/* Conditional renewal nudge. The "real ask" shape of the OPay banner —
          only surfaces when there's actually something to do. */}
      {showRenewalBanner ? (
        <section className="profile-banner" aria-label={subscription ? 'Renewal nudge' : 'Start membership'}>
          <div className="profile-banner-title">
            {isActive
              ? `${remaining} day${remaining === 1 ? '' : 's'} left on your ${plan?.name ?? 'membership'}`
              : subscription
                ? 'Your membership has lapsed'
                : `Start training at ${gym.name}`}
          </div>
          <ul className="profile-banner-list">
            {subscription ? (
              <>
                <li>Renew now to keep your check-ins and class bookings.</li>
                <li>Card on file? It&apos;ll renew in one tap.</li>
                <li>Pause if you&apos;re travelling — admin can help.</li>
              </>
            ) : (
              <>
                <li>Pick a plan to unlock check-ins and class bookings.</li>
                <li>Pay once and we&apos;ll save your card for later.</li>
                <li>Cancel any time — no contracts.</li>
              </>
            )}
          </ul>
          <Link href="/dashboard/renew" className="gf-btn gf-btn-light gf-btn-sm profile-banner-cta">
            {subscription ? 'Renew now' : 'Choose a plan'} <ChevronRight size={14} strokeWidth={2} />
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
          <p>{firstName(p?.full_name)}, read messages or manage channels below.</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
            <Link href="/dashboard/inbox" className="gf-btn gf-btn-ghost gf-btn-sm">Inbox</Link>
            <Link href="#notifications" className="gf-btn gf-btn-ghost gf-btn-sm">Channels</Link>
          </div>
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

      {subscription ? (
        <Card>
          <CardHeader title="Manage subscription" />
          <div style={{ padding: 18 }}>
            <SubscriptionActions
              slug={slug}
              status={subscription.status ?? 'active'}
              autoRenew={!!subscription.auto_debit_enabled}
            />
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Get the app" />
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--gf-text-secondary)' }}>
            Install {gym.name} on your phone for one-tap check-ins and class booking — straight from your home screen, no app store needed.
          </p>
          <InstallAppButton />
        </div>
      </Card>

      <Card>
        <CardHeader title="Account" />
        <div style={{ padding: 18 }}>
          <form action={signOut}>
            <button type="submit" className="gf-btn gf-btn-ghost gf-btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <LogOut size={16} strokeWidth={1.75} /> Sign out
            </button>
          </form>
        </div>
      </Card>
    </div>
  );
}
