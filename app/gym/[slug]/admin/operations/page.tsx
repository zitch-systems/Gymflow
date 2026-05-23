import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDate } from '@/lib/format';

type PageProps = { params: Promise<{ slug: string }> };

export default async function AdminOperationsPage({ params }: PageProps) {
  const { slug } = await params;
  const { gym } = await requireStaff(slug);

  const supabase = await createClient();
  const [{ data: equipment }, { data: expenses }] = await Promise.all([
    supabase
      .from('equipment')
      .select('id, name, category, status, purchase_date, last_maintenance_date')
      .eq('gym_id', gym.id)
      .order('name', { ascending: true })
      .limit(100),
    supabase
      .from('expenses')
      .select('id, description, amount, category, expense_date')
      .eq('gym_id', gym.id)
      .order('expense_date', { ascending: false })
      .limit(50),
  ]);

  return (
    <div className="gf-page">
      <header className="gf-page-header">
        <div>
          <h1 className="gf-page-title">Operations</h1>
          <p className="gf-page-subtitle">Equipment, maintenance, expenses</p>
        </div>
      </header>

      <section className="gf-card">
        <header className="gf-card-header">
          <h2 className="gf-card-title">Equipment ({equipment?.length ?? 0})</h2>
        </header>
        {equipment && equipment.length > 0 ? (
          <div className="gf-table-wrap">
            <table className="gf-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Last maintained</th>
                </tr>
              </thead>
              <tbody>
                {equipment.map((e) => (
                  <tr key={e.id}>
                    <td style={{ fontWeight: 600 }}>{e.name}</td>
                    <td>{e.category ?? '—'}</td>
                    <td>
                      <span className={`status-pill ${e.status === 'available' || e.status === 'active' ? 'on' : 'off'}`}>
                        {e.status ?? 'unknown'}
                      </span>
                    </td>
                    <td>{e.last_maintenance_date ? fmtDate(e.last_maintenance_date) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="gf-empty">
            <div className="gf-empty-icon">🏋️</div>
            <div className="gf-empty-title">No equipment tracked yet</div>
            <div className="gf-empty-text">
              Equipment CRUD UI lands next; meanwhile, add rows directly via the Supabase dashboard.
            </div>
          </div>
        )}
      </section>

      <section className="gf-card">
        <header className="gf-card-header">
          <h2 className="gf-card-title">Recent expenses</h2>
        </header>
        {expenses && expenses.length > 0 ? (
          <div className="gf-table-wrap">
            <table className="gf-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Category</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id}>
                    <td>{e.expense_date ? fmtDate(e.expense_date) : '—'}</td>
                    <td>{e.description ?? '—'}</td>
                    <td>{e.category ?? '—'}</td>
                    <td>{fmtNaira(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="gf-empty">
            <div className="gf-empty-icon">💸</div>
            <div className="gf-empty-title">No expenses recorded</div>
          </div>
        )}
      </section>
    </div>
  );
}
