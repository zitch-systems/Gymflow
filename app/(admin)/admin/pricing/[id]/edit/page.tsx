import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { requireStaff, MANAGER_ROLES } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { PlanForm } from '@/components/admin/plan-form';

export const metadata = { title: 'Edit plan' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function EditPlan({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { gym } = await requireStaff(MANAGER_ROLES);
  const supabase = await createClient();
  const { data: plan } = await supabase
    .from('membership_plans').select('id, name, price, duration_days, duration_months, is_active')
    .eq('id', id).eq('gym_id', gym.id).maybeSingle();
  if (!plan) notFound();
  return (
    <>
      <Link href="/admin/pricing" className="back-link"><ArrowLeft strokeWidth={2} size={16} /> Back to pricing</Link>
      <div className="page-h"><div><h1>Edit plan</h1><p>{plan.name}</p></div></div>
      <div className="panel" style={{ maxWidth: 640 }}>
        <PlanForm plan={{ id: plan.id, name: plan.name, price: Number(plan.price), duration_days: plan.duration_days, duration_months: plan.duration_months, is_active: plan.is_active }} />
      </div>
    </>
  );
}
