import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requireStaff } from '@/lib/auth/dal';
import { AddStaffForm } from '@/components/admin/add-staff-form';

export const metadata = { title: 'Add staff' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function NewStaff() {
  const { gym } = await requireStaff(['gym_owner', 'owner', 'manager']);
  return (
    <>
      <Link href="/admin/instructors" className="back-link"><ArrowLeft strokeWidth={2} size={16} /> Back to staff</Link>
      <div className="page-h"><div><h1>Add staff</h1><p>Invite an instructor or front-desk teammate to {gym.name}.</p></div></div>
      <div className="panel" style={{ maxWidth: 660 }}>
        <AddStaffForm />
      </div>
    </>
  );
}
