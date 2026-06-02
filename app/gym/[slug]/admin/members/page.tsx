import Link from 'next/link';
import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, daysLeft } from '@/lib/format';
import { MembersSearch } from './members-search';
import { ExportMembersCsvButton } from './export-csv-button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { ButtonLink } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/badge';
import { Plus, UserPlus } from 'lucide-react';

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string }>;
};

export default async function AdminMembersPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { gym } = await requireStaff(slug);
  const sp = await searchParams;
  const query = sp.q?.trim() ?? '';

  const supabase = await createClient();

  const { data: links } = await supabase
    .from('gym_member_links')
    .select('user_id, joined_at, status')
    .eq('gym_id', gym.id)
    .order('joined_at', { ascending: false })
    .limit(500);

  const memberIds = (links ?? []).map((l) => l.user_id).filter(Boolean) as string[];

  const profilesPromise =
    memberIds.length > 0
      ? supabase.from('profiles').select('id, full_name, first_name, last_name, email, phone, photo_url, is_active').in('id', memberIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null; first_name: string | null; last_name: string | null; email: string | null; phone: string | null; photo_url: string | null; is_active: boolean | null }> });

  const membershipsPromise =
    memberIds.length > 0
      ? supabase
          .from('memberships')
          .select('member_id, end_date, status')
          .eq('gym_id', gym.id)
          .in('member_id', memberIds)
          .order('end_date', { ascending: false })
      : Promise.resolve({ data: [] as Array<{ member_id: string | null; end_date: string; status: string | null }> });

  const [{ data: profiles }, { data: memberships }] = await Promise.all([profilesPromise, membershipsPromise]);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const activeByMember = new Map<string, { end_date: string; status: string | null }>();
  for (const m of memberships ?? []) {
    if (!m.member_id) continue;
    if (!activeByMember.has(m.member_id)) activeByMember.set(m.member_id, m);
  }

  const rows = (links ?? [])
    .map((l) => {
      const p = l.user_id ? profileById.get(l.user_id) : null;
      const m = l.user_id ? activeByMember.get(l.user_id) : null;
      return {
        userId: l.user_id ?? '',
        name: p?.full_name ?? [p?.first_name, p?.last_name].filter(Boolean).join(' ') ?? '—',
        email: p?.email ?? '—',
        phone: p?.phone ?? '—',
        joined: l.joined_at ?? null,
        expiry: m?.end_date ?? null,
        status: m?.status ?? l.status ?? null,
      };
    })
    .filter((r) => {
      if (!query) return true;
      const q = query.toLowerCase();
      return r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q) || r.phone.toLowerCase().includes(q);
    });

  return (
    <div className="gf-page">
      <PageHeader
        title="Members"
        subtitle={`${rows.length} member${rows.length === 1 ? '' : 's'}`}
        actions={
          <>
            <MembersSearch defaultValue={query} />
            <ExportMembersCsvButton slug={slug} />
            <ButtonLink href="/admin/members/new" variant="primary" size="sm" leadingIcon={<Plus size={16} strokeWidth={2} />}>
              Add member
            </ButtonLink>
          </>
        }
      />

      <Card>
        <div className="gf-table-wrap">
          <table className="gf-table gf-table-cards">
            <thead>
              <tr>
                <th>Member</th>
                <th>Contact</th>
                <th>Joined</th>
                <th>Expiry</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <EmptyState
                      icon={UserPlus}
                      title="No members yet"
                      message="Members appear here after they sign up on the join page or are added by staff."
                    />
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const left = daysLeft(r.expiry);
                  const active = left > 0 && r.status !== 'cancelled';
                  return (
                    <tr key={r.userId}>
                      <td className="gf-td-primary">
                        <Link href={`/admin/members/${r.userId}`} className="gf-link" style={{ fontWeight: 600 }}>
                          {r.name}
                        </Link>
                        <div className="gf-table-meta">{r.email}</div>
                      </td>
                      <td data-label="Contact">{r.phone}</td>
                      <td data-label="Joined">{fmtDate(r.joined)}</td>
                      <td data-label="Expiry">{fmtDate(r.expiry)}</td>
                      <td data-label="Status">
                        <StatusPill tone={active ? 'on' : 'off'}>
                          {active ? `${left}d left` : (r.status ?? 'inactive')}
                        </StatusPill>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
