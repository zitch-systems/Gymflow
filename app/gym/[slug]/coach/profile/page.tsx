import Link from 'next/link';
import { requireInstructor } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { ProfileForm } from './profile-form';
import { RateForm } from './rate-form';
import { BankDetailsForm } from './bank-details-form';

type PageProps = { params: Promise<{ slug: string }> };

type BankRow = {
  bank_code: string | null;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
};

export default async function CoachProfilePage({ params }: PageProps) {
  const { slug } = await params;
  const { gym, user } = await requireInstructor(slug);
  const supabase = await createClient();

  const [{ data: profile }, { data: pricing }, { data: bankRaw }] = await Promise.all([
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
  ]);

  const bank = (bankRaw ?? null) as unknown as BankRow | null;

  return (
    <div className="member-portal member-app">
      <header className="member-header">
        <div>
          <h1 className="gf-page-title">Profile</h1>
          <p className="gf-page-subtitle">{gym.name} · what members see when they browse instructors</p>
        </div>
        <Link href="/coach" className="gf-btn gf-btn-ghost gf-btn-sm">Back</Link>
      </header>

      <section className="gf-card">
        <header className="gf-card-header"><h2 className="gf-card-title">Your details</h2></header>
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
      </section>

      <section className="gf-card">
        <header className="gf-card-header"><h2 className="gf-card-title">Monthly subscription rate</h2></header>
        <RateForm slug={slug} initial={pricing?.price ? Number(pricing.price) : null} />
      </section>

      <section className="gf-card">
        <header className="gf-card-header">
          <h2 className="gf-card-title">Payout bank account</h2>
        </header>
        <p className="gf-page-subtitle" style={{ padding: '0 18px' }}>
          Where {gym.name} sends your revenue share. Only you and gym admins can see this.
        </p>
        <BankDetailsForm
          slug={slug}
          initial={{
            bank_code: bank?.bank_code ?? null,
            bank_name: bank?.bank_name ?? null,
            account_number: bank?.account_number ?? null,
            account_name: bank?.account_name ?? null,
          }}
        />
      </section>
    </div>
  );
}
