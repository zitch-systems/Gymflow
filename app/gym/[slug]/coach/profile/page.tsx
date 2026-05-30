import Link from 'next/link';
import { requireInstructor } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { signOut } from '@/lib/auth/actions';
import { Card, CardHeader } from '@/components/ui/card';
import { ProfileForm } from './profile-form';
import { RateForm } from './rate-form';
import { BankDetailsForm } from './bank-details-form';
import { Wallet, Banknote, Calendar, BarChart3, LogOut, ChevronRight } from 'lucide-react';

type PageProps = { params: Promise<{ slug: string }> };

type BankRow = {
  bank_code: string | null;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
};

const NGN = (n: number) => `₦${n.toLocaleString('en-NG')}`;

export default async function CoachProfilePage({ params }: PageProps) {
  const { slug } = await params;
  const { gym, user } = await requireInstructor(slug);
  const supabase = await createClient();

  const sharePct = gym.instructor_revenue_share_pct ?? 50;

  const [{ data: profile }, { data: pricing }, { data: bankRaw }, { data: monthSubs }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, email, phone, full_name, bio, specialisation, certifications, photo_url')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('instructor_pricing')
      .select('price')
      .eq('gym_id', gym.id)
      .eq('instructor_id', user.id)
      .eq('billing_period', 'monthly')
      .maybeSingle(),
    // instructor_bank_details isn't in the generated types yet
    // (20260529_instructor_bank_details.sql); cast through never. RLS scopes
    // this read to the coach's own row.
    supabase
      .from('instructor_bank_details' as never)
      .select('bank_code, bank_name, account_number, account_name')
      .eq('instructor_id' as never, user.id)
      .maybeSingle(),
    // Earnings this month — same shape as /coach/earnings uses, scoped to the
    // start of the current month so the hero metric matches the earnings page.
    supabase
      .from('instructor_subscriptions')
      .select('amount_paid, created_at')
      .eq('gym_id', gym.id)
      .eq('instructor_id', user.id)
      .gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()),
  ]);

  const bank = (bankRaw ?? null) as unknown as BankRow | null;
  const hasBank = !!bank?.account_number;
  const hasRate = pricing?.price != null;
  const rate = hasRate ? Number(pricing!.price) : 0;

  const monthGross = (monthSubs ?? []).reduce((s, r) => s + (Number(r.amount_paid) || 0), 0);
  const monthShare = Math.round((monthGross * sharePct) / 100);

  const showBankBanner = !hasBank;
  const showRateBanner = !showBankBanner && !hasRate;

  return (
    <div className="member-portal member-app">
      <header className="member-header">
        <div>
          <h1 className="gf-page-title">Profile</h1>
          <p className="gf-page-subtitle">{gym.name} · what members see when they browse instructors</p>
        </div>
        <Link href="/coach" className="gf-btn gf-btn-ghost gf-btn-sm">Back</Link>
      </header>

      {/* Hero — earnings this month. Same gradient + tag-on-top pattern as the
          member dashboard so the two portals feel like one product. */}
      <section className="m-status" aria-label="Earnings this month">
        <span className="m-status-tag">
          <span className="m-status-dot" aria-hidden />
          {sharePct}% share
        </span>
        <div className="m-status-plan">{NGN(monthShare)}</div>
        <div className="m-status-meta">
          Earnings this month · {NGN(monthGross)} gross
        </div>
        <Link href="/coach/earnings" className="gf-btn gf-btn-light gf-btn-sm m-status-renew">
          View earnings <ChevronRight size={14} strokeWidth={2} />
        </Link>
      </section>

      {/* 5-up quick actions. Set-up badge on Bank when missing — that's the
          gating step before payouts can land. */}
      <section className="m-qa m-qa-5" aria-label="Profile shortcuts">
        <Link href="/coach/earnings" className="m-qa-tile">
          <BarChart3 size={20} strokeWidth={1.75} />
          <span>Earnings</span>
        </Link>
        <Link href="#rate" className="m-qa-tile">
          <Wallet size={20} strokeWidth={1.75} />
          <span>Pricing</span>
          {!hasRate ? <span className="m-qa-badge">Set</span> : null}
        </Link>
        <Link href="#bank" className="m-qa-tile">
          <Banknote size={20} strokeWidth={1.75} />
          <span>Bank</span>
          {!hasBank ? <span className="m-qa-badge">Set</span> : null}
        </Link>
        <Link href="/coach/timetable" className="m-qa-tile">
          <Calendar size={20} strokeWidth={1.75} />
          <span>Schedule</span>
        </Link>
        <form action={signOut} style={{ display: 'contents' }}>
          <button type="submit" className="m-qa-tile">
            <LogOut size={20} strokeWidth={1.75} />
            <span>Sign out</span>
          </button>
        </form>
      </section>

      {/* Conditional setup nudge: bank missing > rate missing > nothing. Only
          one banner at a time — the bank one wins because no payouts can
          land without it. */}
      {showBankBanner ? (
        <section className="profile-banner" aria-label="Setup nudge">
          <div className="profile-banner-title">Add your bank details to get paid</div>
          <ul className="profile-banner-list">
            <li>Payouts settle directly to your bank — no manual transfers.</li>
            <li>Only you and gym admin can see this.</li>
            <li>Takes about 30 seconds.</li>
          </ul>
          <Link href="#bank" className="gf-btn gf-btn-light gf-btn-sm profile-banner-cta">
            Set up bank <ChevronRight size={14} strokeWidth={2} />
          </Link>
        </section>
      ) : showRateBanner ? (
        <section className="profile-banner" aria-label="Setup nudge">
          <div className="profile-banner-title">Set your monthly rate</div>
          <ul className="profile-banner-list">
            <li>Members can&apos;t subscribe to you until a rate is set.</li>
            <li>Adjust it any time — existing subscriptions are unaffected.</li>
            <li>You keep {sharePct}% of every payment.</li>
          </ul>
          <Link href="#rate" className="gf-btn gf-btn-light gf-btn-sm profile-banner-cta">
            Set rate <ChevronRight size={14} strokeWidth={2} />
          </Link>
        </section>
      ) : null}

      {/* 2-up summary cards. Each one mirrors a form section below, with a
          deep link into it. Same identity-bearing constraint as the member
          page: changing email goes through support, not self-serve. */}
      <section className="profile-pair" aria-label="Account summary">
        <div className="profile-pair-card">
          <h3>Monthly rate</h3>
          <p style={{ fontWeight: 600, color: 'var(--gf-text)' }}>
            {hasRate ? NGN(rate) : 'Not set'}
          </p>
          <p>{hasRate ? `You keep ${NGN(Math.round((rate * sharePct) / 100))} per subscriber.` : 'Set a rate so members can subscribe to you.'}</p>
          <Link href="#rate" className="gf-btn gf-btn-ghost gf-btn-sm">{hasRate ? 'Edit' : 'Set'} rate</Link>
        </div>
        <div className="profile-pair-card">
          <h3>Payout bank</h3>
          <p style={{ fontWeight: 600, color: 'var(--gf-text)' }}>
            {hasBank ? bank!.bank_name ?? 'Bank set' : 'Not set'}
          </p>
          <p>{hasBank ? `••••${(bank!.account_number ?? '').slice(-4)} · ${bank!.account_name ?? ''}` : 'Where the gym sends your share of revenue.'}</p>
          <Link href="#bank" className="gf-btn gf-btn-ghost gf-btn-sm">{hasBank ? 'Edit' : 'Add'} bank</Link>
        </div>
      </section>

      <Card>
        <CardHeader title="Your details" />
        <ProfileForm
          userId={user.id}
          slug={slug}
          initial={{
            full_name: profile?.full_name ?? null,
            email: profile?.email ?? null,
            phone: profile?.phone ?? null,
            bio: profile?.bio ?? null,
            specialisation: profile?.specialisation ?? null,
            certifications: profile?.certifications ?? null,
            photo_url: profile?.photo_url ?? null,
          }}
        />
      </Card>

      <Card>
        <CardHeader title="Monthly subscription rate" />
        <div id="rate">
          <RateForm slug={slug} initial={hasRate ? rate : null} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Payout bank account" />
        <p className="gf-page-subtitle" style={{ padding: '0 18px' }}>
          Where {gym.name} sends your revenue share. Only you and gym admins can see this.
        </p>
        <div id="bank">
          <BankDetailsForm
            slug={slug}
            initial={{
              bank_code: bank?.bank_code ?? null,
              bank_name: bank?.bank_name ?? null,
              account_number: bank?.account_number ?? null,
              account_name: bank?.account_name ?? null,
            }}
          />
        </div>
      </Card>
    </div>
  );
}
