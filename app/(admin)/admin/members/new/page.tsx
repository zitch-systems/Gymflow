import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requireStaff } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { AddMemberForm } from '@/components/admin/add-member-form';

export const metadata = { title: 'Add member' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function NewMember() {
  const { gym } = await requireStaff();
  const supabase = await createClient();
  const { data: plans } = await supabase
    .from('membership_plans')
    .select('id, name, price')
    .eq('gym_id', gym.id)
    .eq('is_active', true)
    .order('price');

  return (
    <>
      <Link href="/admin/members" className="back-link"><ArrowLeft strokeWidth={2} size={16} /> Back to members</Link>
      <div className="page-h"><div><h1>Add member</h1><p>Create a member record for {gym.name}.</p></div></div>
      <div className="panel" style={{ maxWidth: 660 }}>
        <AddMemberForm plans={(plans ?? []).map((p) => ({ id: p.id, name: p.name ?? 'Plan', price: Number(p.price ?? 0) }))} />
      </div>
    </>
  );
}
