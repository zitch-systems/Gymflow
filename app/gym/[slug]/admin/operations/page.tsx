import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira } from '@/lib/format';
import { EquipmentCrud } from './equipment-crud';
import { ExpensesCrud } from './expenses-crud';
import { Stat } from '@/components/ui/stat';
import { LayoutGrid, Dumbbell, Wrench, Receipt } from 'lucide-react';

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

  const totalEquipment = (equipment ?? []).length;
  const zones = new Set((equipment ?? []).map((e) => e.location).filter((x): x is string => Boolean(x))).size;
  const todayIso = new Date().toISOString().split('T')[0];
  const needsMaintenance = (equipment ?? []).filter((e) => {
    if (e.status === 'maintenance' || e.status === 'broken') return true;
    if (e.next_maintenance_date && e.next_maintenance_date <= todayIso) return true;
    return false;
  }).length;

  // Expenses (last 30 days) — total spend for the headline KPI.
  const DAY_MS = 86_400_000;
  const thirtyAgo = new Date(Date.now() - 30 * DAY_MS).toISOString().split('T')[0];
  const recent30Expenses = (expenses ?? []).filter((e) => e.expense_date && e.expense_date >= thirtyAgo);
  const spend30 = recent30Expenses.reduce((s, e) => s + Number(e.amount ?? 0), 0);

  return (
    <div className="gf-page">
      <div className="page-h">
        <div>
          <h1>Operations</h1>
          <p>{gym.name} · {zones} zone{zones === 1 ? '' : 's'} · {totalEquipment} equipment unit{totalEquipment === 1 ? '' : 's'}</p>
        </div>
      </div>

      <section className="kpis">
        <Stat label="Active zones" value={zones} accent="emerald" icon={LayoutGrid} />
        <Stat label="Equipment units" value={totalEquipment} accent="blue" icon={Dumbbell} />
        <Stat label="Need maintenance" value={needsMaintenance} accent="amber" icon={Wrench} />
        <Stat label="Spend (30d)" value={fmtNaira(spend30)} accent="lime" icon={Receipt} />
      </section>

      <div className="panel">
        <div className="panel-h">
          <div>
            <h3>Equipment</h3>
            <div className="sub">{totalEquipment} unit{totalEquipment === 1 ? '' : 's'} across {zones} zone{zones === 1 ? '' : 's'}</div>
          </div>
        </div>
        <EquipmentCrud slug={slug} gymId={gym.id} items={equipment ?? []} />
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-h">
          <div>
            <h3>Expenses</h3>
            <div className="sub">Last 100 entries · {fmtNaira(spend30)} in the last 30 days</div>
          </div>
        </div>
        <ExpensesCrud slug={slug} gymId={gym.id} items={expenses ?? []} />
      </div>
    </div>
  );
}
