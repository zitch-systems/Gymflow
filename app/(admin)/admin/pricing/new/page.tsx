import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requireStaff, MANAGER_ROLES } from '@/lib/auth/dal';
import { PlanForm } from '@/components/admin/plan-form';

export const metadata = { title: 'New plan' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function NewPlan() {
  await requireStaff(MANAGER_ROLES);
  return (
    <>
      <Link href="/admin/pricing" className="back-link"><ArrowLeft strokeWidth={2} size={16} /> Back to pricing</Link>
      <div className="page-h"><div><h1>New plan</h1><p>Create a membership plan.</p></div></div>
      <div className="panel" style={{ maxWidth: 640 }}><PlanForm /></div>
    </>
  );
}
