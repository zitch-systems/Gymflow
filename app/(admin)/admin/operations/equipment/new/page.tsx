import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requireStaff } from '@/lib/auth/dal';
import { EquipmentForm } from '@/components/admin/equipment-form';

export const metadata = { title: 'Add equipment' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function NewEquipment() {
  await requireStaff();
  return (
    <>
      <Link href="/admin/operations" className="back-link"><ArrowLeft strokeWidth={2} size={16} /> Back to facility</Link>
      <div className="page-h"><div><h1>Add equipment</h1><p>Log a new piece of equipment and its maintenance schedule.</p></div></div>
      <div className="panel" style={{ maxWidth: 760 }}><EquipmentForm /></div>
    </>
  );
}
