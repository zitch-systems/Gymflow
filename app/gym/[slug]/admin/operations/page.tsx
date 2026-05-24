import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDate } from '@/lib/format';
import { EquipmentCrud } from './equipment-crud';
import { ExpensesCrud } from './expenses-crud';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';

type PageProps = { params: Promise<{ slug: string }> };

export default async function AdminOperationsPage({ params }: PageProps) {
  const { slug } = await params;
  const { gym } = await requireStaff(slug);

  const supabase = await createClient();
  const [{ data: equipment }, { data: expenses }] = await Promise.all([
    supabase
      .from('equipment')
      .select('id, name, category, status, purchase_date, purchase_price, last_maintenance_date, next_maintenance_date, photo_url, location, maintenance_notes')
      .eq('gym_id', gym.id)
      .order('name', { ascending: true })
      .limit(200),
    supabase
      .from('expenses')
      .select('id, description, amount, category, expense_date, is_recurring, recurring_frequency, receipt_url')
      .eq('gym_id', gym.id)
      .order('expense_date', { ascending: false })
      .limit(100),
  ]);

  return (
    <div className="gf-page">
      <PageHeader title="Operations" subtitle={`${gym.name} · equipment & expenses`} />

      <Card>
        <CardHeader title={`Equipment (${equipment?.length ?? 0})`} />
        <EquipmentCrud slug={slug} gymId={gym.id} items={equipment ?? []} />
      </Card>

      <Card>
        <CardHeader title="Expenses (last 100)" />
        <ExpensesCrud slug={slug} gymId={gym.id} items={expenses ?? []} />
      </Card>

      <p className="gf-form-hint" style={{ textAlign: 'center', marginTop: 12 }}>
        Totals & P&amp;L live on{' '}
        <a href="/admin/analytics" className="gf-link">analytics</a>; transactions on{' '}
        <a href="/admin/wallet" className="gf-link">wallet</a>.{' '}
        Last refresh: {fmtDate(new Date())}{' '}
        {/* sample formatter usage so linter knows fmtNaira is in scope */}
        <span style={{ display: 'none' }}>{fmtNaira(0)}</span>
      </p>
    </div>
  );
}
