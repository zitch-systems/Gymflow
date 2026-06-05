import Link from 'next/link';
import { requireInstructor } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { signOut } from '@/lib/auth/actions';
import { Wallet, Banknote, BarChart3, UserCircle2, LogOut, Pencil } from 'lucide-react';

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

  const rate = Number((pricing as { price?: number } | null)?.price ?? 0);
  const hasRate = rate > 0;
  const bank = bankRaw as BankRow | null;
  const hasBank = Boolean(bank?.bank_name && bank?.account_number);
  const monthRevenue = (monthSubs ?? []).reduce((s, m) => s + Number(m.amount_paid ?? 0), 0);
  const monthShare = Math.round((monthRevenue * sharePct) / 100);

  const displayName = profile?.full_name ?? profile?.email ?? 'Coach';
  const avatarInitial = (profile?.full_name ?? profile?.email ?? 'C').charAt(0).toUpperCase();

  return (
    <div className="gf-page">
      <div className="page-h">
        <div>
          <h1>Profile</h1>
          <p>{displayName} · {sharePct}% revenue share with {gym.name}</p>
        </div>
        <form action={signOut}>
          <button type="submit" className="gf-btn gf-btn-ghost gf-btn-sm">
            <LogOut size={14} strokeWidth={1.9} /> Sign out
          </button>
        </form>
      </div>

      <div className="panel">
        <div className="panel-title">Public profile</div>
        <div className="panel-desc">Members see this when they browse coaches at {gym.name}.</div>
        <div className="set-row">
          <span className="gf-avatar gf-avatar-lg" style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)', borderColor: 'var(--gf-brand-glow)' }}>
            {profile?.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.photo_url} alt="" />
            ) : avatarInitial}
          </span>
          <div className="m">
            <strong>{displayName}</strong>
            <small>{profile?.specialisation ?? 'Coach'}</small>
          </div>
          <Link href="/coach/profile/edit" className="gf-btn gf-btn-primary gf-btn-sm">
            <Pencil size={14} strokeWidth={1.9} /> Edit
          </Link>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-title">Get paid</div>
        <div className="panel-desc">Your session rate and where the gym sends your share.</div>

        <div className="set-row">
          <span className="gf-avatar gf-avatar-sm" style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)', borderColor: 'transparent' }}>
            <Wallet size={16} strokeWidth={1.9} />
          </span>
          <div className="m">
            <strong>Session rate</strong>
            <small>{hasRate ? `You keep ${NGN(Math.round((rate * sharePct) / 100))} per subscriber` : 'Members can’t subscribe until this is set'}</small>
          </div>
          {hasRate ? (
            <span className="naira" style={{ fontSize: '0.95rem', marginRight: 12 }}>{NGN(rate)}</span>
          ) : null}
          <Link href="/coach/profile/rate" className={`gf-btn gf-btn-sm ${hasRate ? 'gf-btn-secondary' : 'gf-btn-primary'}`}>
            {hasRate ? 'Edit' : 'Set rate'}
          </Link>
        </div>

        <div className="set-row">
          <span className="gf-avatar gf-avatar-sm" style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)', borderColor: 'transparent' }}>
            <Banknote size={16} strokeWidth={1.9} />
          </span>
          <div className="m">
            <strong>Payout bank</strong>
            <small>{hasBank ? `${bank!.bank_name ?? 'Bank'} ····${(bank!.account_number ?? '').slice(-4)}` : 'Where the gym sends your share'}</small>
          </div>
          <Link href="/coach/profile/bank" className={`gf-btn gf-btn-sm ${hasBank ? 'gf-btn-secondary' : 'gf-btn-primary'}`}>
            {hasBank ? 'Update' : 'Add bank'}
          </Link>
        </div>

        <div className="set-row">
          <span className="gf-avatar gf-avatar-sm" style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)', borderColor: 'transparent' }}>
            <BarChart3 size={16} strokeWidth={1.9} />
          </span>
          <div className="m">
            <strong>Earnings</strong>
            <small>{sharePct}% share this month</small>
          </div>
          <span className="naira" style={{ fontSize: '0.95rem', marginRight: 12 }}>{NGN(monthShare)}</span>
          <Link href="/coach/earnings" className="gf-btn gf-btn-secondary gf-btn-sm">
            Open
          </Link>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-title">Account</div>
        <div className="set-row">
          <span className="gf-avatar gf-avatar-sm" style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)', borderColor: 'transparent' }}>
            <UserCircle2 size={16} strokeWidth={1.9} />
          </span>
          <div className="m">
            <strong>Public profile</strong>
            <small>Photo, bio, specialisation, certifications</small>
          </div>
          <Link href="/coach/profile/edit" className="gf-btn gf-btn-secondary gf-btn-sm">Edit</Link>
        </div>
      </div>
    </div>
  );
}
