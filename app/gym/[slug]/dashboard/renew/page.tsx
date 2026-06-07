import Link from 'next/link';
import { requireMember } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { daysLeft } from '@/lib/format';
import { RenewPlanPicker } from './renew-plan-picker';
import { EmptyState } from '@/components/ui/empty-state';
import { ArrowLeft, ClipboardList } from 'lucide-react';

export const metadata = { title: 'Renew membership' };

type PageProps = { params: Promise<{ slug: string }> };

export default async function RenewPage({ params }: PageProps) {
  const { slug } = await params;
  const { user, gym } = await requireMember(slug);

  const supabase = await createClient();
  const [{ data: plans }, { data: subscription }] = await Promise.all([
    supabase
      .from('membership_plans')
      .select('*')
      .eq('gym_id', gym.id)
      .eq('is_active', true)
      .order('price', { ascending: true }),
    supabase
      .from('member_subscriptions')
      .select('end_date, status, plan_id')
      .eq('member_id', user.id)
      .eq('gym_id', gym.id)
      .eq('status', 'active')
      .order('end_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const planName = new Map((plans ?? []).map((p) => [p.id, p.name]));
  const remaining = subscription?.end_date ? daysLeft(subscription.end_date) : 0;
  const currentPlan = subscription?.plan_id ? planName.get(subscription.plan_id) ?? null : null;
  const context = remaining > 0
    ? currentPlan
      ? `Your ${currentPlan} plan renews in ${remaining} day${remaining === 1 ? '' : 's'}. Renew early to lock in your rate.`
      : `Your membership renews in ${remaining} day${remaining === 1 ? '' : 's'}. Renew early to lock in your rate.`
    : subscription
      ? `Your membership expired. Pick a plan to start training again at ${gym.name}.`
      : `Pick a plan to start training at ${gym.name}.`;

  return (
    <div className="ds-member">
      <div className="view on" data-v="renew">
        <div className="mhead" style={{ justifyContent: 'space-between', paddingBottom: 10 }}>
          <Link href="/dashboard/wallet" className="icon-btn" style={{ width: 34, height: 34 }} aria-label="Back to wallet">
            <ArrowLeft strokeWidth={1.9} />
          </Link>
          <strong className="htitle">Renew membership</strong>
          <span style={{ width: 34, height: 34 }} aria-hidden />
        </div>

        {!plans || plans.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No plans available" message="The gym hasn't published any active plans yet." />
        ) : (
          <>
            <p style={{ color: 'var(--gf-text-secondary)', fontSize: '0.88rem', margin: '0 0 16px' }}>
              {context}
            </p>
            <RenewPlanPicker
              plans={plans.map((p) => ({
                id: p.id,
                name: p.name,
                duration_months: p.duration_months,
                price: p.price,
                description: p.description,
              }))}
              gymId={gym.id}
              email={user.email ?? ''}
              subaccount={gym.paystack_subaccount_code}
            />
          </>
        )}
      </div>
    </div>
  );
}
