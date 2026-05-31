import { redirect } from 'next/navigation';
import { requireManager } from '@/lib/auth/gym';
import { getSessionUser } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { PLATFORM_PRICING, isBillingPeriod, formatNaira } from '@/lib/platform-pricing';
import { fmtDate } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { BillingPayButton } from './billing-pay';

export const metadata = { title: 'Billing' };

const STATUS_LABEL: Record<string, string> = {
  trial: 'Trial',
  active: 'Active',
  past_due: 'Past due',
  cancelled: 'Cancelled',
};

const BILLING_PLAN_LABEL: Record<string, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Annual',
};

export default async function BillingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { gym, role } = await requireManager(slug);
  const user = await getSessionUser();
  if (!user) redirect(`/gym/${slug}/login`);

  void role;

  // Privileged reads via the admin client — RLS on platform_payments is
  // SELECT-restricted to platform_admin + the gym's owner. The admin client
  // keeps the page render reliable regardless of how that policy evolves.
  const admin = createAdminClient();

  const billing = isBillingPeriod(gym.subscription_plan) ? gym.subscription_plan : 'monthly';
  const plan = PLATFORM_PRICING[billing];

  const [{ data: payments }, { data: card }] = await Promise.all([
    admin
      .from('platform_payments')
      .select('id, amount, payment_status, paystack_reference, billing_period_start, billing_period_end, created_at')
      .eq('gym_id', gym.id)
      .order('created_at', { ascending: false })
      .limit(12),
    admin
      .from('saved_cards')
      .select('last4, brand, bank, exp_month, exp_year')
      .eq('gym_id', gym.id)
      .eq('member_id', user.id)
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return (
    <div className="gf-page">
      <PageHeader
        title="Billing"
        subtitle="Your GymFlow platform subscription. Member payments settle separately into your Paystack subaccount."
      />

      <Card padded>
        <div className="mini-stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <div className="mini-stat">
            <div className="mini-stat-label">Plan</div>
            <div className="mini-stat-value">{BILLING_PLAN_LABEL[billing] ?? plan.label}</div>
            <div className="mini-stat-sub">{formatNaira(plan.amount)} / {plan.per}</div>
          </div>
          <div className="mini-stat">
            <div className="mini-stat-label">Status</div>
            <div className="mini-stat-value">
              <span className={`status-pill ${gym.subscription_status === 'active' ? 'on' : 'off'}`}>
                {STATUS_LABEL[gym.subscription_status ?? ''] ?? gym.subscription_status ?? '—'}
              </span>
            </div>
          </div>
          <div className="mini-stat">
            <div className="mini-stat-label">Next charge</div>
            <div className="mini-stat-value">{gym.trial_ends_at ? fmtDate(gym.trial_ends_at) : '—'}</div>
          </div>
          <div className="mini-stat">
            <div className="mini-stat-label">Card on file</div>
            <div className="mini-stat-value">
              {card ? `${card.brand?.toUpperCase() ?? 'CARD'} ····${card.last4 ?? '????'}` : 'None'}
            </div>
            {card && card.exp_month && card.exp_year ? (
              <div className="mini-stat-sub">
                Exp {String(card.exp_month).padStart(2, '0')}/{String(card.exp_year).slice(-2)}
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ marginTop: 22 }}>
          <BillingPayButton
            gymId={gym.id}
            email={user.email ?? ''}
            amountNaira={plan.amount}
            label={card ? 'Renew now / update card' : 'Pay & save card'}
          />
          <p className="gf-form-hint" style={{ marginTop: 10 }}>
            Charges your card today for one {plan.per} of GymFlow and saves it for auto-renew.
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title="Recent platform charges" />
        <div className="gf-table-wrap">
          <table className="gf-table">
            <thead><tr><th>Date</th><th>Period</th><th>Amount</th><th>Status</th><th>Reference</th></tr></thead>
            <tbody>
              {(payments ?? []).map((p) => (
                <tr key={p.id}>
                  <td>{p.created_at ? fmtDate(p.created_at) : '—'}</td>
                  <td>
                    {p.billing_period_start ? fmtDate(p.billing_period_start) : '—'}
                    {' → '}
                    {p.billing_period_end ? fmtDate(p.billing_period_end) : '—'}
                  </td>
                  <td>{formatNaira(Number(p.amount ?? 0))}</td>
                  <td><span className={`status-pill ${p.payment_status === 'successful' ? 'on' : 'off'}`}>{p.payment_status}</span></td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{p.paystack_reference ?? '—'}</td>
                </tr>
              ))}
              {(payments ?? []).length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--gf-text-muted)' }}>No platform charges yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
