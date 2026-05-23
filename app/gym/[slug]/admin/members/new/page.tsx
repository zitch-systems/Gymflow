import Link from 'next/link';
import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { ManualOnboardForm } from './manual-onboard-form';

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
      <header className="gf-page-header">
        <div>
          <h1 className="gf-page-title">Onboard a member</h1>
          <p className="gf-page-subtitle">Used when staff are signing someone up at the front desk.</p>
        </div>
        <Link href="/admin/members" className="gf-btn gf-btn-ghost gf-btn-sm">
          Back to members
        </Link>
      </header>

      <div className="gf-card">
        <ManualOnboardForm slug={slug} plans={plans ?? []} />
      </div>
    </div>
  );
}
