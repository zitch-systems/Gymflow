import { requireStaff } from '@/lib/auth/gym';
import { createAdminClient } from '@/lib/supabase/admin';
import { fmtNaira, fmtDate } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Dumbbell } from 'lucide-react';
import { PtPackForm, GrantPackForm, DeactivateButton } from './pt-packs-client';

type PageProps = { params: Promise<{ slug: string }> };

type Pack = { id: string; name: string; instructor_id: string; session_count: number; price: number; is_active: boolean };
type Credit = { id: string; pack_id: string | null; member_id: string; sessions_total: number; sessions_used: number; purchased_at: string };
type Instructor = { user_id: string; profiles: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null };
type MemberLink = { user_id: string; profiles: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null };

function profileOne<T extends { profiles: unknown }>(r: T): { full_name: string | null; email: string | null } | null {
  const p = (r.profiles as { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null);
  if (!p) return null;
  return Array.isArray(p) ? (p[0] ?? null) : p;
}

export default async function AdminPtPacksPage({ params }: PageProps) {
  const { slug } = await params;
  const { gym } = await requireStaff(slug);
  const admin = createAdminClient();

  // pt_packs / pt_pack_credits aren't in the generated types yet (migration
  // 20260530_pt_packs.sql) — cast through never.
  const [{ data: packsRaw }, { data: instructorsRaw }, { data: creditsRaw }, { data: membersRaw }] = await Promise.all([
    admin
      .from('pt_packs' as never)
      .select('id, name, instructor_id, session_count, price, is_active')
      .eq('gym_id' as never, gym.id)
      .order('is_active' as never, { ascending: false })
      .order('created_at' as never, { ascending: false }),
    admin
      .from('gym_staff_links')
      .select('user_id, profiles:user_id(full_name, email)')
      .eq('gym_id', gym.id)
      .eq('role', 'instructor')
      .eq('is_active', true),
    admin
      .from('pt_pack_credits' as never)
      .select('id, pack_id, member_id, sessions_total, sessions_used, purchased_at')
      .eq('gym_id' as never, gym.id)
      .order('purchased_at' as never, { ascending: false })
      .limit(200),
    admin
      .from('gym_member_links')
      .select('user_id, profiles:user_id(full_name, email)')
      .eq('gym_id', gym.id)
      .eq('is_active', true)
      .eq('status', 'active')
      .limit(500),
  ]);

  const packs = (packsRaw ?? []) as unknown as Pack[];
  const instructors = ((instructorsRaw ?? []) as unknown as Instructor[]).map((i) => ({
    user_id: i.user_id,
    label: profileOne(i)?.full_name ?? profileOne(i)?.email ?? i.user_id,
  }));
  const credits = (creditsRaw ?? []) as unknown as Credit[];
  const members = ((membersRaw ?? []) as unknown as MemberLink[]).map((m) => ({
    user_id: m.user_id,
    label: profileOne(m)?.full_name ?? profileOne(m)?.email ?? m.user_id,
  })).sort((a, b) => (a.label ?? '').localeCompare(b.label ?? ''));

  // member display name lookup for the credits list
  const memberLabel = new Map(members.map((m) => [m.user_id, m.label] as const));
  const packLabel = new Map(packs.map((p) => [p.id, p.name] as const));
  const instructorLabel = new Map(instructors.map((i) => [i.user_id, i.label] as const));

  return (
    <div className="gf-page">
      <PageHeader
        title="Personal training packs"
        subtitle="Sell session packs for your coaches and grant them to members."
      />

      <Card>
        <CardHeader title="Create a pack" />
        <PtPackForm slug={slug} instructors={instructors} />
      </Card>

      <Card>
        <CardHeader title={`Active packs (${packs.filter((p) => p.is_active).length})`} />
        {packs.length === 0 ? (
          <EmptyState icon={Dumbbell} title="No packs yet" message="Create one above to start selling sessions." />
        ) : (
          <div className="gf-table-wrap">
            <table className="gf-table gf-table-cards">
              <thead>
                <tr><th>Name</th><th>Coach</th><th>Sessions</th><th>Price</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {packs.map((p) => (
                  <tr key={p.id} style={{ opacity: p.is_active ? 1 : 0.55 }}>
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td className="gf-table-meta">{instructorLabel.get(p.instructor_id) ?? p.instructor_id.slice(0, 8)}</td>
                    <td>{p.session_count}</td>
                    <td>{fmtNaira(p.price)}</td>
                    <td>
                      <span className={`status-pill ${p.is_active ? 'on' : 'off'}`}>
                        {p.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td><DeactivateButton slug={slug} packId={p.id} isActive={p.is_active} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Grant a pack" />
        <GrantPackForm
          slug={slug}
          packs={packs.filter((p) => p.is_active).map((p) => ({ id: p.id, label: `${p.name} (${p.session_count}× · ${fmtNaira(p.price)})` }))}
          members={members}
        />
      </Card>

      <Card>
        <CardHeader title={`Member balances (${credits.length})`} />
        {credits.length === 0 ? (
          <EmptyState icon={Dumbbell} title="No purchases yet" message="Granted packs appear here." />
        ) : (
          <div className="gf-table-wrap">
            <table className="gf-table gf-table-cards">
              <thead>
                <tr><th>Member</th><th>Pack</th><th>Used / Total</th><th>Purchased</th></tr>
              </thead>
              <tbody>
                {credits.map((c) => (
                  <tr key={c.id} style={{ opacity: c.sessions_used >= c.sessions_total ? 0.55 : 1 }}>
                    <td>{memberLabel.get(c.member_id) ?? c.member_id.slice(0, 8)}</td>
                    <td className="gf-table-meta">{c.pack_id ? packLabel.get(c.pack_id) ?? '—' : '—'}</td>
                    <td>{c.sessions_used} / {c.sessions_total}</td>
                    <td className="gf-table-meta">{fmtDate(c.purchased_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
