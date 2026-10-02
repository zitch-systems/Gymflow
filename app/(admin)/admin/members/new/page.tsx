import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requireStaff } from '@/lib/auth/dal';
import { AddMemberForm } from '@/components/admin/add-member-form';

export const metadata = { title: 'Add member' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function NewMember() {
  const { gym } = await requireStaff();

  return (
    <>
      <Link href="/admin/members" className="back-link"><ArrowLeft strokeWidth={2} size={16} /> Back to members</Link>
      <div className="page-h"><div><h1>Add member</h1><p>Create a member record for {gym.name}.</p></div></div>
      <div className="panel" style={{ maxWidth: 660 }}>
        <AddMemberForm />
      </div>
    </>
  );
}
