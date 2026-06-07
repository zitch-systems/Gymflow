import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { PayoutsForm } from './payouts-form';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { ButtonLink } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/badge';
import { ArrowLeft } from 'lucide-react';

type PageProps = { params: Promise<{ slug: string }> };

export default async function PayoutsSettingsPage({ params }: PageProps) {
  const { slug } = await params;
  const { gym } = await requireStaff(slug);

  const supabase = await createClient();
  const { data: full } = await supabase
    .from('gyms')
    .select('paystack_subaccount_code, bank_code, bank_name, account_number, account_name, platform_commission_pct')
    .eq('id', gym.id)
    .maybeSingle();

  return (
    <div className="gf-page">
      <PageHeader
        title="Payouts"
        subtitle="Connect your bank account so member payments land in your wallet."
        actions={
          <ButtonLink href="/admin/settings" variant="ghost" size="sm" leadingIcon={<ArrowLeft size={16} strokeWidth={1.75} />}>
            Back
          </ButtonLink>
        }
      />

      <Card>
        <CardHeader
          title="Bank account"
          action={
            full?.paystack_subaccount_code ? (
              <StatusPill tone="on">Connected</StatusPill>
            ) : (
              <StatusPill tone="off">Not connected</StatusPill>
            )
          }
        />
        <div style={{ padding: 18 }}>
          <p style={{ margin: '0 0 16px', color: 'var(--gf-text-secondary)', fontSize: '0.875rem' }}>
            We send {(full?.platform_commission_pct ?? 5).toString()}% to GymFlow as platform commission and the rest directly to your account on every member payment.
            {full?.paystack_subaccount_code && (
              <>
                <br />
                <strong style={{ color: 'var(--gf-text)' }}>Subaccount code:</strong>{' '}
                <code style={{ fontFamily: 'ui-monospace,Menlo,monospace', fontSize: '0.8125rem' }}>{full.paystack_subaccount_code}</code>
              </>
            )}
          </p>
          <PayoutsForm
            slug={slug}
            initial={{
              bank_code: full?.bank_code ?? null,
              bank_name: full?.bank_name ?? null,
              account_number: full?.account_number ?? null,
              account_name: full?.account_name ?? null,
            }}
          />
        </div>
      </Card>
    </div>
  );
}
