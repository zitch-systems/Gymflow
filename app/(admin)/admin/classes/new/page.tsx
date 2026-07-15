import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requireStaff, MANAGER_ROLES } from '@/lib/auth/dal';
import { ClassForm } from '@/components/admin/class-form';

export const metadata = { title: 'New class' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function NewClass() {
  // createClass() requires MANAGER_ROLES — gate the page the same way so front
  // desk can't fill out the whole form only to have the submit silently bounce
  // them to /launch.
  await requireStaff(MANAGER_ROLES);
  return (
    <>
      <Link href="/admin/classes" className="back-link"><ArrowLeft strokeWidth={2} size={16} /> Back to classes</Link>
      <div className="page-h"><div><h1>New class</h1><p>Add a class and its weekly time slot.</p></div></div>
      <div className="panel" style={{ maxWidth: 720 }}><ClassForm /></div>
    </>
  );
}
