import Link from 'next/link';
import { requireMember } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { RenewPlanPicker } from './renew-plan-picker';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
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
    <div className="member-portal member-app">
      <header className="member-header">
        <div>
          <h1 className="gf-page-title">Renew membership</h1>
          <p className="gf-page-subtitle">Pick a plan to extend your membership at {gym.name}.</p>
        </div>
        <Link href="/dashboard" className="gf-btn gf-btn-ghost gf-btn-sm" aria-label="Back">
          <ArrowLeft size={16} strokeWidth={1.75} /> Back
        </Link>
      </header>

      {!plans || plans.length === 0 ? (
        <Card>
          <EmptyState icon={ClipboardList} title="No plans available" message="The gym hasn't published any active plans yet." />
        </Card>
      ) : (
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
      )}
    </div>
  );
}
