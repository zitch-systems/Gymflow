import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira } from '@/lib/format';
import { PlanCreateForm, PlanDeleteButton } from './pricing-forms';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Tag } from 'lucide-react';

type PageProps = { params: Promise<{ slug: string }> };

export default async function AdminPricingPage({ params }: PageProps) {
  const { slug } = await params;
  const { gym } = await requireStaff(slug);

  const supabase = await createClient();
  const { data: plans } = await supabase
    .from('membership_plans')
    .select('*')
    .eq('gym_id', gym.id)
    .order('price', { ascending: true });

  return (
    <div className="gf-page">
      <PageHeader title="Pricing plans" subtitle={`${plans?.length ?? 0} plan(s)`} />

      <Card>
        <CardHeader title="Create a plan" />
        <PlanCreateForm slug={slug} />
      </Card>

      <Card>
        <CardHeader title="Current plans" />
        {plans && plans.length > 0 ? (
          <div className="gf-table-wrap">
            <table className="gf-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Duration</th>
                  <th>Price</th>
                  <th>Active</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{p.name}</div>
                      <div className="gf-table-meta">{p.description ?? '—'}</div>
                    </td>
                    <td>
                      {p.duration_months} month{p.duration_months === 1 ? '' : 's'}
                    </td>
                    <td>{fmtNaira(p.price)}</td>
                    <td>
                      <span className={`status-pill ${p.is_active ? 'on' : 'off'}`}>
                        {p.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
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
