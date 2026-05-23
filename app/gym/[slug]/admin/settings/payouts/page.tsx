import Link from 'next/link';
import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { PayoutsForm } from './payouts-form';

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
      <header className="gf-page-header">
        <div>
          <h1 className="gf-page-title">Payouts</h1>
          <p className="gf-page-subtitle">Connect your bank account so member payments land in your wallet.</p>
        </div>
        <Link href="/admin/settings" className="gf-btn gf-btn-ghost gf-btn-sm">Back</Link>
      </header>

      <section className="gf-card">
        <header className="gf-card-header">
          <h2 className="gf-card-title">Bank account</h2>
          {full?.paystack_subaccount_code ? (
            <span className="status-pill on">Connected</span>
          ) : (
            <span className="status-pill off">Not connected</span>
          )}
        </header>
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
      </section>
    </div>
  );
}
