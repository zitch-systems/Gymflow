import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira } from '@/lib/format';
import { todayIso } from '@/lib/dates';
import { PlanCreateForm, PlanDeleteButton } from './pricing-forms';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Stat } from '@/components/ui/stat';
import { Tag, Users, CreditCard, Repeat, PlusCircle } from 'lucide-react';

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

  const planById = new Map((plans ?? []).map((p) => [p.id, p] as const));
  const activeSubs = (activeMembs ?? []).filter((m) => m.plan_id && planById.has(m.plan_id));

  // Members count per plan (active subscriptions only).
  const membersByPlan = new Map<string, number>();
  for (const m of activeSubs) {
    const k = m.plan_id as string;
    membersByPlan.set(k, (membersByPlan.get(k) ?? 0) + 1);
  }

  // MRR normalises each subscription to a monthly figure (price / duration months).
  let mrrTotal = 0;
  const mrrByPlan = new Map<string, number>();
  for (const p of plans ?? []) {
    const members = membersByPlan.get(p.id) ?? 0;
    const months = p.duration_months || 1;
    const mrr = (Number(p.price ?? 0) / months) * members;
    mrrByPlan.set(p.id, mrr);
    mrrTotal += mrr;
  }
  const subscribers = activeSubs.length;
  const arpu = subscribers > 0 ? mrrTotal / subscribers : 0;
  const activePlanCount = (plans ?? []).filter((p) => p.is_active).length;

  // Most-subscribed plan gets the "Popular" badge.
  let popularPlanId: string | null = null;
  let popularMembers = -1;
  for (const [id, count] of membersByPlan) {
    if (count > popularMembers) { popularMembers = count; popularPlanId = id; }
  }

  const periodLabel = (months: number): string => {
    if (months <= 1) return '/mo';
    if (months === 3) return '/qtr';
    if (months === 12) return '/yr';
    return `/${months}mo`;
  };

  return (
    <div className="gf-page">
      <PageHeader
        title="Pricing & plans"
        subtitle={`${activePlanCount} active plan${activePlanCount === 1 ? '' : 's'} · ${fmtNaira(Math.round(mrrTotal))} monthly recurring`}
      />

      <div className="adm-pricing-kpis">
        <Stat label="Monthly recurring" value={fmtNaira(Math.round(mrrTotal))} accent="emerald" icon={Repeat} />
        <Stat label="On a paid plan" value={subscribers} accent="blue" icon={Users} />
        <Stat label="Avg revenue / member" value={fmtNaira(Math.round(arpu))} accent="purple" icon={CreditCard} />
      </div>

      {plans && plans.length > 0 ? (
        <div className="adm-plans">
          {plans.map((p) => {
            const members = membersByPlan.get(p.id) ?? 0;
            const planMrr = mrrByPlan.get(p.id) ?? 0;
            const isPopular = popularPlanId === p.id && members > 0;
            return (
              <div key={p.id} className={`adm-plan${isPopular ? ' pop' : ''}`}>
                <div className="adm-plan-top">
                  <span className="adm-plan-nm">
                    {p.name}
                    {isPopular ? <span className="gf-badge gf-badge-brand" style={{ marginLeft: 6 }}>Popular</span> : null}
                    {!p.is_active ? <span className="gf-badge gf-badge-neutral" style={{ marginLeft: 6 }}>Inactive</span> : null}
                  </span>
                </div>
                <div className="adm-plan-amt">
                  {fmtNaira(p.price)}
                  <small>{periodLabel(p.duration_months || 1)}</small>
                </div>
                <div className="adm-plan-desc">{p.description ?? '—'}</div>
                <div className="adm-plan-stat">
                  <div>
                    <div className="adm-plan-stat-v">{members}</div>
                    <div className="adm-plan-stat-l">Members</div>
                  </div>
                  <div>
                    <div className="adm-plan-stat-v">{fmtNaira(Math.round(planMrr))}</div>
                    <div className="adm-plan-stat-l">MRR</div>
                  </div>
                </div>
                <div className="adm-plan-acts">
                  <PlanDeleteButton slug={slug} planId={p.id} />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Card>
          <EmptyState icon={Tag} title="No plans yet" message="Create your first plan below so members can subscribe." />
        </Card>
      )}

      <Card>
        <CardHeader title="Add a new plan" />
        <PlanCreateForm slug={slug} />
      </Card>
    </div>
  );
}
