import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { requireStaff } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { EquipmentForm, DeleteEquipmentButton } from '@/components/admin/equipment-form';

export const metadata = { title: 'Edit equipment' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function EditEquipment({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { gym } = await requireStaff();
  const supabase = await createClient();
  const { data: e } = await supabase
    .from('equipment')
    .select('id, name, category, location, status, serial_number, vendor, purchase_date, purchase_price, last_maintenance_date, next_maintenance_date, maintenance_notes')
    .eq('id', id).eq('gym_id', gym.id).maybeSingle();
  if (!e) notFound();
  return (
    <>
      <Link href="/admin/operations" className="back-link"><ArrowLeft strokeWidth={2} size={16} /> Back to facility</Link>
      <div className="page-h"><div><h1>Edit equipment</h1><p>{e.name}</p></div></div>
      <div className="panel" style={{ maxWidth: 760 }}>
        <EquipmentForm equipment={{ ...e, purchase_price: e.purchase_price != null ? Number(e.purchase_price) : null }} />
        <DeleteEquipmentButton id={e.id} />
      </div>
    </>
  );
}
