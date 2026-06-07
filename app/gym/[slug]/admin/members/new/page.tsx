import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { ManualOnboardForm } from './manual-onboard-form';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { ButtonLink } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

type PageProps = { params: Promise<{ slug: string }> };

export default async function AdminNewMemberPage({ params }: PageProps) {
  const { slug } = await params;
  const { gym } = await requireStaff(slug);

  const supabase = await createClient();
  const { data: plans } = await supabase
    .from('membership_plans')
    .select('id, name, price, duration_months')
    .eq('gym_id', gym.id)
    .eq('is_active', true)
    .order('price', { ascending: true });

  return (
    <div className="gf-page">
      <PageHeader
        title="Onboard a member"
        subtitle="Used when staff are signing someone up at the front desk."
        actions={
          <ButtonLink href="/admin/members" variant="ghost" size="sm" leadingIcon={<ArrowLeft size={16} strokeWidth={1.75} />}>
            Back to members
          </ButtonLink>
        }
      />

      <Card>
        <ManualOnboardForm slug={slug} plans={plans ?? []} />
      </Card>
    </div>
  );
}
