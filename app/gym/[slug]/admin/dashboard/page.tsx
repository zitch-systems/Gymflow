import Link from 'next/link';
import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDate, daysLeft } from '@/lib/format';
import { signOut } from '@/lib/auth/actions';
import { daysFromNowIso, startOfTodayIso, todayIso } from '@/lib/dates';
import { Stat, StatGrid } from '@/components/ui/stat';
import { QuickAction, QuickActions } from '@/components/ui/quick-action';
import { Card, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill } from '@/components/ui/badge';
import { ButtonLink, Button } from '@/components/ui/button';
import {
  Users, CalendarCheck, Clock4, Banknote, LayoutGrid,
  Tag, BarChart3, Settings, Plus, LogOut, UserPlus,
} from 'lucide-react';

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function AdminDashboard({ params }: PageProps) {
  const { slug } = await params;
  const { role, gym } = await requireStaff(slug);

  const supabase = await createClient();
  const startOfToday = startOfTodayIso();

  const [
    { count: memberCount },
    { count: activeToday },
    { count: expiringSoon },
    { data: revenueRows },
    { data: recentLinks },
  ] = await Promise.all([
    supabase
      .from('gym_member_links')
      .select('*', { count: 'exact', head: true })
      .eq('gym_id', gym.id),
    supabase
      .from('check_ins')
      .select('*', { count: 'exact', head: true })
      .eq('gym_id', gym.id)
      .gte('checked_in_at', startOfToday),
    supabase
      .from('memberships')
      .select('*', { count: 'exact', head: true })
      .eq('gym_id', gym.id)
      .gte('end_date', todayIso())
      .lte('end_date', daysFromNowIso(7)),
    supabase
      .from('payments')
      .select('amount')
      .eq('gym_id', gym.id)
      .eq('payment_status', 'successful')
      .gte('payment_date', startOfToday),
    supabase
      .from('gym_member_links')
      .select('user_id, joined_at, status')
      .eq('gym_id', gym.id)
      .order('joined_at', { ascending: false })
      .limit(5),
  ]);

  const revenueToday = (revenueRows ?? []).reduce((acc, p) => acc + Number(p.amount ?? 0), 0);

  const recentIds = (recentLinks ?? []).map((l) => l.user_id).filter(Boolean) as string[];
  const [{ data: recentProfiles }, { data: recentMemberships }] = await Promise.all([
    recentIds.length
      ? supabase.from('profiles').select('id, full_name, first_name, last_name, email').in('id', recentIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null; first_name: string | null; last_name: string | null; email: string | null }> }),
    recentIds.length
      ? supabase.from('memberships').select('member_id, end_date, status').eq('gym_id', gym.id).in('member_id', recentIds)
      : Promise.resolve({ data: [] as Array<{ member_id: string | null; end_date: string; status: string | null }> }),
  ]);
  const profileById = new Map((recentProfiles ?? []).map((p) => [p.id, p]));
  const membershipByMember = new Map<string, { end_date: string; status: string | null }>();
  for (const m of recentMemberships ?? []) {
    if (m.member_id && !membershipByMember.has(m.member_id)) membershipByMember.set(m.member_id, m);
  }

  const recentRows = (recentLinks ?? []).map((l) => {
    const p = l.user_id ? profileById.get(l.user_id) : null;
    const m = l.user_id ? membershipByMember.get(l.user_id) : null;
    return {
      id: l.user_id ?? '',
      name: p?.full_name ?? [p?.first_name, p?.last_name].filter(Boolean).join(' ') ?? '—',
      email: p?.email ?? '—',
      joined: l.joined_at ?? null,
      expiry: m?.end_date ?? null,
      status: m?.status ?? l.status ?? null,
    };
  });

  return (
    <div className="gf-page">
      <PageHeader
        title={gym.name}
        subtitle={`Admin Dashboard · ${role}`}
        actions={
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm" leadingIcon={<LogOut size={16} strokeWidth={1.75} />}>
              Sign out
            </Button>
          </form>
        }
      />

      <StatGrid>
        <Stat label="Total members" value={memberCount ?? 0} accent="emerald" icon={Users} />
        <Stat label="Active today" value={activeToday ?? 0} accent="blue" icon={CalendarCheck} />
        <Stat label="Expiring this week" value={expiringSoon ?? 0} accent="amber" icon={Clock4} />
        <Stat label="Revenue today" value={fmtNaira(revenueToday)} accent="purple" icon={Banknote} />
      </StatGrid>

      <QuickActions>
        <QuickAction href="/admin/members" icon={LayoutGrid} label="Members" />
        <QuickAction href="/admin/pricing" icon={Tag} label="Pricing" />
        <QuickAction href="/admin/analytics" icon={BarChart3} label="Analytics" />
        <QuickAction href="/admin/operations" icon={Settings} label="Operations" />
      </QuickActions>

      <Card>
        <CardHeader
          title="Recent members"
          action={
            <ButtonLink href="/admin/members/new" variant="primary" size="sm" leadingIcon={<Plus size={16} strokeWidth={2} />}>
              Add member
            </ButtonLink>
          }
        />
        {recentRows.length === 0 ? (
          <EmptyState
            icon={UserPlus}
            title="No members yet"
            message="Members appear here after they sign up on the join page or are added by staff."
            action={
              <ButtonLink href="/admin/members/new" variant="outline" size="sm" leadingIcon={<Plus size={16} strokeWidth={2} />}>
                Add the first member
              </ButtonLink>
            }
          />
        ) : (
          <div className="gf-table-wrap">
            <table className="gf-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Joined</th>
                  <th>Expiry</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recentRows.map((r) => {
                  const left = daysLeft(r.expiry);
                  const active = left > 0 && r.status !== 'cancelled';
                  return (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/admin/members/${r.id}`} className="gf-link" style={{ fontWeight: 600 }}>
                          {r.name}
                        </Link>
                        <div className="gf-table-meta">{r.email}</div>
                      </td>
                      <td>{fmtDate(r.joined)}</td>
                      <td>{fmtDate(r.expiry)}</td>
                      <td>
                        <StatusPill tone={active ? 'on' : 'off'}>
                          {active ? `${left}d left` : (r.status ?? 'inactive')}
                        </StatusPill>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
