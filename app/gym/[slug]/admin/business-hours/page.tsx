import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { BusinessHoursForm } from './hours-form';

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type PageProps = { params: Promise<{ slug: string }> };

export default async function AdminBusinessHoursPage({ params }: PageProps) {
  const { slug } = await params;
  const { gym } = await requireStaff(slug);

  const supabase = await createClient();
  const { data } = await supabase.from('business_hours').select('*').eq('gym_id', gym.id);
  const byDow = new Map<number, { open_time: string | null; close_time: string | null; is_closed: boolean | null }>();
  for (const r of data ?? []) byDow.set(r.day_of_week, r);

  const rows = Array.from({ length: 7 }, (_, dow) => ({
    dow,
    label: DAY_LABELS[dow],
    open: byDow.get(dow)?.open_time ?? '06:00',
    close: byDow.get(dow)?.close_time ?? '22:00',
    closed: byDow.get(dow)?.is_closed ?? false,
  }));

  return (
    <div className="gf-page">
      <header className="gf-page-header">
        <div>
          <h1 className="gf-page-title">Business hours</h1>
          <p className="gf-page-subtitle">Visible to members on their dashboard and the join page.</p>
        </div>
      </header>

      <div className="gf-card">
        <BusinessHoursForm slug={slug} rows={rows} />
      </div>
    </div>
  );
}
