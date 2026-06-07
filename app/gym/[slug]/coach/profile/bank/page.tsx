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
    <div className="gf-page">
      <header className="mhead" style={{ justifyContent: 'space-between', paddingBottom: 6 }}>
        <Link href="/coach/profile" className="icon-btn" style={{ width: 34, height: 34 }} aria-label="Back to profile">
          <ArrowLeft strokeWidth={1.9} />
        </Link>
        <strong className="htitle">Payout bank</strong>
        <span style={{ width: 34, height: 34 }} aria-hidden />
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
