import Link from 'next/link';
import { requireInstructor } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { signOut } from '@/lib/auth/actions';
import { InstallAppButton } from '@/lib/pwa-install';
import { Wallet, Banknote, BarChart3, UserCircle2, Smartphone, LogOut, ChevronRight, Pencil } from 'lucide-react';

export const metadata = { title: 'Profile' };

type PageProps = { params: Promise<{ slug: string }> };

type BankRow = {
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
    supabase.from('profiles').select('full_name, email, specialisation, photo_url').eq('id', user.id).maybeSingle(),
    supabase
      .from('instructor_pricing')
      .select('price')
      .eq('gym_id', gym.id)
      .eq('instructor_id', user.id)
      .eq('billing_period', 'monthly')
      .maybeSingle(),
    supabase
      .from('instructor_bank_details' as never)
      .select('bank_name, account_number, account_name')
      .eq('instructor_id' as never, user.id)
      .maybeSingle(),
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

  const displayName = profile?.full_name ?? profile?.email ?? 'Coach';
  const avatarInitial = (profile?.full_name ?? profile?.email ?? 'C').charAt(0).toUpperCase();

  return (
    <div className="member-portal member-app">
      <header className="member-header">
        <div><h1 className="gf-page-title">Profile</h1></div>
      </header>

      {/* Profile header → public profile editor */}
      <Link href="/coach/profile/edit" className="gf-profile-card">
        <span className="gf-profile-av">
          {profile?.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.photo_url} alt="" />
          ) : avatarInitial}
        </span>
        <span className="gf-profile-m">
          <strong>{displayName}</strong>
          <small>{profile?.specialisation ?? `${gym.name} · Coach`}</small>
        </span>
        <Pencil size={18} strokeWidth={1.75} className="gf-srow-chev" />
      </Link>

      <div className="gf-slist">
        <section className="gf-slist-sec" aria-label="Get paid">
          <div className="gf-slist-title">Get paid</div>
          <div className="gf-slist-group">
            <Link href="/coach/profile/rate" className="gf-srow">
              <span className="gf-srow-ic"><Wallet /></span>
              <span className="gf-srow-m">
                <strong>Session rate</strong>
                <small>{hasRate ? `You keep ${NGN(Math.round((rate * sharePct) / 100))} per subscriber` : 'Members can’t subscribe until this is set'}</small>
              </span>
              {hasRate ? <span className="gf-srow-val">{NGN(rate)}</span> : <span className="gf-srow-pill">Set</span>}
              <ChevronRight size={18} strokeWidth={1.9} className="gf-srow-chev" />
            </Link>
            <Link href="/coach/profile/bank" className="gf-srow">
              <span className="gf-srow-ic"><Banknote /></span>
              <span className="gf-srow-m">
                <strong>Payout bank</strong>
                <small>{hasBank ? `${bank!.bank_name ?? 'Bank'} ····${(bank!.account_number ?? '').slice(-4)}` : 'Where the gym sends your share'}</small>
              </span>
              {hasBank ? null : <span className="gf-srow-pill">Set</span>}
              <ChevronRight size={18} strokeWidth={1.9} className="gf-srow-chev" />
            </Link>
            <Link href="/coach/earnings" className="gf-srow">
              <span className="gf-srow-ic"><BarChart3 /></span>
              <span className="gf-srow-m">
                <strong>Earnings</strong>
                <small>{sharePct}% share this month</small>
              </span>
              <span className="gf-srow-val">{NGN(monthShare)}</span>
              <ChevronRight size={18} strokeWidth={1.9} className="gf-srow-chev" />
            </Link>
          </div>
        </section>

        <section className="gf-slist-sec" aria-label="Profile">
          <div className="gf-slist-title">Profile</div>
          <div className="gf-slist-group">
            <Link href="/coach/profile/edit" className="gf-srow">
              <span className="gf-srow-ic"><UserCircle2 /></span>
              <span className="gf-srow-m"><strong>Public profile</strong><small>Photo, bio, specialisation, certifications</small></span>
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
