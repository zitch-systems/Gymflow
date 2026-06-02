import { redirect } from 'next/navigation';
import { isPlatformAdmin, requireAuth } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, fmtNaira } from '@/lib/format';
import { signOut } from '@/lib/auth/actions';
import { daysAgoIso } from '@/lib/dates';
import { SuperadminGymRowActions } from './gym-row-actions';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Stat, StatGrid } from '@/components/ui/stat';
import { Button, ButtonLink } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/badge';
import { Search, ShieldCheck, Plus, LogOut, Building2, CheckCircle2, TrendingDown, AlertTriangle, Users, Banknote } from 'lucide-react';

export default async function SuperadminPage() {
  await requireAuth();
  if (!(await isPlatformAdmin())) redirect('/');

  // RLS policies grant platform_admins cross-gym read access; no need for
  // the service-role client (which requires SUPABASE_SERVICE_ROLE_KEY).
  const admin = await createClient();
  const since30 = daysAgoIso(30);
  const since35 = daysAgoIso(35);

  const [
    { data: gyms },
    { count: gymCount },
    { count: activeGymCount },
    { count: profileCount },
    { data: platformPayments30 },
    { data: recentChurn },
    { data: paidGymIds },
  ] = await Promise.all([
    admin
      .from('gyms')
      .select('id, name, slug, subscription_status, subscription_plan, created_at, trial_ends_at, email')
      .order('created_at', { ascending: false })
      .limit(100),
    admin.from('gyms').select('*', { count: 'exact', head: true }),
    admin.from('gyms').select('*', { count: 'exact', head: true }).eq('subscription_status', 'active'),
    admin.from('profiles').select('*', { count: 'exact', head: true }),
    admin
      .from('platform_payments')
      .select('amount, created_at')
      .eq('payment_status', 'successful')
      .gte('created_at', since30),
    admin
      .from('gyms')
      .select('id', { count: 'exact' })
      .in('subscription_status', ['suspended', 'terminated', 'cancelled'])
      .gte('updated_at', since30),
    admin
      .from('platform_payments')
      .select('gym_id')
      .eq('payment_status', 'successful')
      .gte('created_at', since35),
  ]);

  const mrr30 = (platformPayments30 ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const churned = recentChurn?.length ?? 0;
  const totalGyms = gymCount ?? 0;
  const churnPct = totalGyms > 0 ? Math.round((churned / totalGyms) * 1000) / 10 : 0;

  const paidIds = new Set((paidGymIds ?? []).map((r) => r.gym_id));
  const overdue = (gyms ?? []).filter((g) => g.subscription_status === 'active' && !paidIds.has(g.id)).length;

  return (
    <div className="gf-page">
      <PageHeader
        title="Platform admin"
        subtitle="All gyms across GymFlow"
        actions={
          <>
            <ButtonLink href="/superadmin/members" variant="ghost" size="sm" leadingIcon={<Search size={16} strokeWidth={1.75} />}>
              Find member
            </ButtonLink>
            <ButtonLink href="/superadmin/audit" variant="ghost" size="sm" leadingIcon={<ShieldCheck size={16} strokeWidth={1.75} />}>
              Audit log
            </ButtonLink>
            <ButtonLink href="/superadmin/gyms/new" variant="primary" size="sm" leadingIcon={<Plus size={16} strokeWidth={2} />}>
              Onboard gym
            </ButtonLink>
            <form action={signOut}>
              <Button type="submit" variant="ghost" size="sm" leadingIcon={<LogOut size={16} strokeWidth={1.75} />}>
                Sign out
              </Button>
            </form>
          </>
        }
      />

      <StatGrid>
        <Stat label="Total gyms" value={totalGyms} icon={Building2} accent="emerald" />
        <Stat label="Active gyms" value={activeGymCount ?? 0} icon={CheckCircle2} accent="blue" />
        <Stat label="MRR (30d platform fees)" value={fmtNaira(mrr30)} icon={Banknote} accent="purple" />
        <Stat label="Churn 30d" value={`${churnPct}%`} icon={TrendingDown} accent="amber" />
        <Stat label="Overdue (no payment 35d)" value={overdue} icon={AlertTriangle} accent="rose" />
        <Stat label="Total profiles" value={profileCount ?? 0} icon={Users} accent="slate" />
      </StatGrid>

      <Card>
        <CardHeader title="Gyms" />
        <div className="gf-table-wrap">
          <table role="table" className="gf-table gf-table-cards">
            <thead>
              <tr role="row">
                <th>Name</th>
                <th>Slug</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Trial ends</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody role="rowgroup">
              {(gyms ?? []).map((g) => (
                <tr role="row" key={g.id}>
                  <td role="cell">
                    <a href={`https://${g.slug}.gymflow.ng/admin/dashboard`} className="gf-link" target="_blank" rel="noreferrer">
                      {g.name}
                    </a>
                    <div className="gf-table-meta">{g.email ?? '—'}</div>
                  </td>
                  <td role="cell" className="gf-table-meta" data-label="Slug">{g.slug}</td>
                  <td role="cell" data-label="Plan">{g.subscription_plan ?? '—'}</td>
                  <td role="cell" data-label="Status">
                    <StatusPill tone={g.subscription_status === 'active' ? 'on' : 'off'}>
                      {g.subscription_status ?? '—'}
                    </StatusPill>
                  </td>
                  <td role="cell" data-label="Trial ends">{g.trial_ends_at ? fmtDate(g.trial_ends_at) : '—'}</td>
                  <td role="cell" data-label="Created">{fmtDate(g.created_at)}</td>
                  <td role="cell">
                    <SuperadminGymRowActions
                      gymId={g.id}
                      slug={g.slug}
                      ownerEmail={g.email ?? ''}
                      status={g.subscription_status ?? 'unknown'}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

