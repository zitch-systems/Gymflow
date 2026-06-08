import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requireStaff } from '@/lib/auth/dal';
import { ClassForm } from '@/components/admin/class-form';

export const metadata = { title: 'New class' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function NewClass() {
  await requireStaff();
  return (
    <>
      <Link href="/admin/classes" className="back-link"><ArrowLeft strokeWidth={2} size={16} /> Back to classes</Link>
      <div className="page-h"><div><h1>New class</h1><p>Add a class and its weekly time slot.</p></div></div>
      <div className="panel" style={{ maxWidth: 720 }}><ClassForm /></div>
    </>
  );
}
