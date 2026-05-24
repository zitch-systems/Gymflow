import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';
import { WaiverForm } from './waiver-form';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { FileText } from 'lucide-react';

type PageProps = { params: Promise<{ slug: string }> };

export default async function AdminWaiverPage({ params }: PageProps) {
  const { slug } = await params;
  const { gym } = await requireStaff(slug);

  const supabase = await createClient();
  const [{ data: active }, { data: sigs }] = await Promise.all([
    supabase.from('waivers').select('*').eq('gym_id', gym.id).eq('is_active', true).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase
      .from('waiver_signatures')
      .select('id, signed_at, member_id, profiles:member_id(full_name, email)')
      .eq('gym_id', gym.id)
      .order('signed_at', { ascending: false })
      .limit(50),
  ]);

  return (
    <div className="gf-page">
      <PageHeader title="Waiver" subtitle="Edit the active waiver members agree to on signup." />

      <Card>
        <CardHeader title={`Active waiver${active ? ` · v${active.version ?? '1.0'}` : ''}`} />
        <WaiverForm
          slug={slug}
          defaultTitle={active?.title ?? 'Membership waiver'}
          defaultContent={active?.content ?? ''}
          defaultVersion={active?.version ?? '1.0'}
        />
      </Card>

      <Card>
        <CardHeader title={`Recent signatures (${sigs?.length ?? 0})`} />
        {sigs && sigs.length > 0 ? (
          <ul className="gf-list">
            {sigs.map((s) => {
              const p = Array.isArray(s.profiles) ? s.profiles[0] : s.profiles;
              return (
                <li key={s.id} className="gf-list-row">
                  <span>
                    <strong>{p?.full_name ?? '—'}</strong>
                    <span className="gf-table-meta"> · {p?.email ?? '—'}</span>
                  </span>
                  <span className="gf-table-meta">{s.signed_at ? fmtDate(s.signed_at) : '—'}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState icon={FileText} title="No signatures yet" />
        )}
      </Card>
    </div>
  );
}
