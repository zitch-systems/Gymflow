import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira } from '@/lib/format';
import { todayIso } from '@/lib/dates';
import { PlanCreateForm, PlanDeleteButton } from './pricing-forms';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Stat, StatGrid } from '@/components/ui/stat';
import { Tag, Coins, Users, BadgeCheck } from 'lucide-react';

type PageProps = { params: Promise<{ slug: string }> };

export default async function AdminPricingPage({ params }: PageProps) {
  const { slug } = await params;
  const { gym } = await requireStaff(slug);

  const supabase = await createClient();
  const [{ data: plans }, { data: activeMembs }] = await Promise.all([
    supabase
      .from('membership_plans')
      .select('*')
      .eq('gym_id', gym.id)
      .order('price', { ascending: true }),
    supabase
      .from('memberships')
      .select('plan_id')
      .eq('gym_id', gym.id)
      .eq('status', 'active')
      .gte('end_date', todayIso()),
  ]);

  // MRR normalises each active subscription to a monthly figure (price / term);
  // ARPU divides that by active subscribers. Prices come from the plan list above.
  const planById = new Map((plans ?? []).map((p) => [p.id, p] as const));
  const activeSubs = (activeMembs ?? []).filter((m) => m.plan_id && planById.has(m.plan_id));
  const mrr = activeSubs.reduce((sum, m) => {
    const p = planById.get(m.plan_id as string)!;
    const months = p.duration_months || 1;
    return sum + Number(p.price ?? 0) / months;
  }, 0);
  const subscribers = activeSubs.length;
  const arpu = subscribers > 0 ? mrr / subscribers : 0;
  const activePlans = (plans ?? []).filter((p) => p.is_active).length;

  return (
    <div className="gf-page">
      <PageHeader title="Pricing plans" subtitle={`${plans?.length ?? 0} plan(s)`} />

      <StatGrid>
        <Stat label="MRR" value={fmtNaira(Math.round(mrr))} accent="emerald" icon={Coins} />
        <Stat label="ARPU" value={fmtNaira(Math.round(arpu))} accent="blue" icon={Users} />
        <Stat label="Active subscribers" value={subscribers} accent="purple" icon={BadgeCheck} />
        <Stat label="Active plans" value={activePlans} accent="amber" icon={Tag} />
      </StatGrid>

      <Card>
        <CardHeader title="Create a plan" />
        <PlanCreateForm slug={slug} />
      </Card>

      <Card>
        <CardHeader title="Current plans" />
        {plans && plans.length > 0 ? (
          <div className="gf-table-wrap">
            <table role="table" className="gf-table gf-table-cards">
              <thead>
                <tr role="row">
                  <th>Name</th>
                  <th>Duration</th>
                  <th>Price</th>
                  <th>Active</th>
                  <th />
                </tr>
              </thead>
              <tbody role="rowgroup">
                {plans.map((p) => (
                  <tr role="row" key={p.id}>
                    <td role="cell">
                      <div style={{ fontWeight: 600 }}>{p.name}</div>
                      <div className="gf-table-meta">{p.description ?? '—'}</div>
                    </td>
                    <td role="cell" data-label="Duration">
                      {p.duration_months} month{p.duration_months === 1 ? '' : 's'}
                    </td>
                    <td role="cell" data-label="Price">{fmtNaira(p.price)}</td>
                    <td role="cell" data-label="Active">
                      <span className={`status-pill ${p.is_active ? 'on' : 'off'}`}>
                        {p.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td role="cell">
                      <PlanDeleteButton slug={slug} planId={p.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={Tag} title="No plans yet" message="Create your first plan above so members can subscribe." />
        )}
      </Card>
    </div>
  );
}
