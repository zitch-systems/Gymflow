import Link from 'next/link';
import { requireInstructor } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader } from '@/components/ui/card';
import { BankDetailsForm } from '../bank-details-form';
import { ArrowLeft } from 'lucide-react';

export const metadata = { title: 'Payout bank' };

type PageProps = { params: Promise<{ slug: string }> };

type BankRow = {
  bank_code: string | null;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
};

export default async function CoachBankPage({ params }: PageProps) {
  const { slug } = await params;
  const { gym, user } = await requireInstructor(slug);
  const supabase = await createClient();
  // instructor_bank_details isn't in the generated types yet
  // (20260529_instructor_bank_details.sql); cast through never. RLS scopes
  // this read to the coach's own row.
  const { data: bankRaw } = await supabase
    .from('instructor_bank_details' as never)
    .select('bank_code, bank_name, account_number, account_name')
    .eq('instructor_id' as never, user.id)
    .maybeSingle();
  const bank = (bankRaw ?? null) as unknown as BankRow | null;

  return (
    <div className="op-mobile member-portal member-app">
      <header className="member-header">
        <div>
          <h1 className="gf-page-title">Payout bank</h1>
          <p className="gf-page-subtitle">Where {gym.name} sends your revenue share. Only you and gym admins can see this.</p>
        </div>
        <Link href="/coach/profile" className="gf-btn gf-btn-ghost gf-btn-sm" aria-label="Back to profile">
          <ArrowLeft size={16} strokeWidth={1.75} /> Back
        </Link>
      </header>

      <Card>
        <CardHeader title="Payout bank account" />
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
