import { requireMember } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira } from '@/lib/format';
import { PaystackPayButton } from './paystack-pay';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { ButtonLink } from '@/components/ui/button';
import { ArrowLeft, ClipboardList } from 'lucide-react';

type PageProps = { params: Promise<{ slug: string }> };

export default async function RenewPage({ params }: PageProps) {
  const { slug } = await params;
  const { user, gym } = await requireMember(slug);

  const supabase = await createClient();
  const { data: plans } = await supabase
    .from('membership_plans')
    .select('*')
    .eq('gym_id', gym.id)
    .eq('is_active', true)
    .order('price', { ascending: true });

  return (
    <div className="gf-page">
      <PageHeader
        title="Renew membership"
        subtitle={`Pick a plan to extend your membership at ${gym.name}.`}
        actions={
          <ButtonLink href="/dashboard" variant="ghost" size="sm" leadingIcon={<ArrowLeft size={16} strokeWidth={1.75} />}>
            Back to dashboard
          </ButtonLink>
        }
      />

      {!plans || plans.length === 0 ? (
        <Card>
          <EmptyState icon={ClipboardList} title="No plans available" message="The gym hasn't published any active plans yet." />
        </Card>
      ) : (
        <div className="plan-grid">
          {plans.map((p) => (
            <article key={p.id} className="plan-card">
              <h3 className="plan-card-title">{p.name}</h3>
              <p className="plan-card-meta">
                {p.duration_months} month{p.duration_months === 1 ? '' : 's'}
              </p>
              <p className="plan-card-price">{fmtNaira(p.price)}</p>
              {p.description && <p className="plan-card-desc">{p.description}</p>}
              <PaystackPayButton
                gymId={gym.id}
                planId={p.id}
                amount={p.price}
                durationMonths={p.duration_months}
                email={user.email ?? ''}
                subaccount={gym.paystack_subaccount_code}
              />
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
