import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fmtDate, fmtDateTime, fmtNaira, daysLeft } from '@/lib/format';
import { MemberAdminActions } from './member-admin-actions';
import { TagsAndNotesCard } from './tags-notes-card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { ButtonLink } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/badge';
import { ArrowLeft, ClipboardList, Banknote, MapPin, Cake } from 'lucide-react';
import { daysUntilBirthday } from '@/lib/birthdays';

type PageProps = { params: Promise<{ slug: string; id: string }> };

export default async function AdminMemberDetailPage({ params }: PageProps) {
  const { slug, id } = await params;
  const { gym } = await requireStaff(slug);

  const supabase = await createClient();
  // staff_notes ships in 20260530_member_tags_and_notes.sql but isn't in the
  // generated types yet — cast through never so the select typechecks against
  // the older union.
  const { data: link } = await supabase
    .from('gym_member_links')
    .select('joined_at, status, is_active, onboarding_method, staff_notes' as never)
    .eq('gym_id', gym.id)
    .eq('user_id', id)
    .maybeSingle();
  if (!link) notFound();
  const linkRow = link as unknown as { joined_at: string | null; status: string | null; is_active: boolean | null; onboarding_method: string | null; staff_notes: string | null };

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, first_name, last_name, email, phone, date_of_birth, gender, address, nok_name, nok_relationship, nok_phone, nok_address, health_notes, waiver_signed_at')
    .eq('id', id)
    .maybeSingle();

  // member_tags reads via the service-role client — the table has no
  // authenticated-role policies by design (admin-only writes, admin-only
  // reads from the staff portal). requireStaff above proves authorization.
  const adminClient = createAdminClient();
  const [{ data: memberships }, { data: payments }, { data: checkIns }, { data: tagRowsRaw }] = await Promise.all([
    supabase
      .from('memberships')
      .select('id, start_date, end_date, status, plan_id, auto_debit_enabled, auto_renew, membership_plans:plan_id(name, price)')
      .eq('gym_id', gym.id)
      .eq('member_id', id)
      .order('end_date', { ascending: false })
      .limit(10),
    supabase
      .from('payments')
      .select('id, amount, currency, payment_method, payment_status, payment_date, paystack_reference, membership_plans:plan_id(name)')
      .eq('gym_id', gym.id)
      .eq('member_id', id)
      .order('payment_date', { ascending: false })
      .limit(10),
    supabase
      .from('check_ins')
      .select('id, checked_in_at, check_in_method')
      .eq('gym_id', gym.id)
      .eq('member_id', id)
      .order('checked_in_at', { ascending: false })
      .limit(10),
    adminClient
      .from('member_tags' as never)
      .select('tag')
      .eq('gym_id' as never, gym.id)
      .eq('user_id' as never, id)
      .order('created_at' as never, { ascending: true }),
  ]);
  const tags = ((tagRowsRaw ?? []) as unknown as Array<{ tag: string }>).map((r) => r.tag);
  const bday = daysUntilBirthday(profile?.date_of_birth);

  const active = memberships?.[0];
  const left = active ? daysLeft(active.end_date) : 0;

  return (
    <div className="gf-page">
      <PageHeader
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            {profile?.full_name ?? profile?.email ?? 'Member'}
            {bday === 0 && (
              <span
                className="status-pill on"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}
                title={`Birthday today · ${fmtDate(profile?.date_of_birth ?? null)}`}
              >
                <Cake size={12} strokeWidth={2.25} /> Birthday today
              </span>
            )}
            {bday !== null && bday > 0 && bday <= 7 && (
              <span className="status-pill" style={{ fontSize: 12 }}>
                🎂 in {bday} day{bday === 1 ? '' : 's'}
              </span>
            )}
          </span>
        }
        subtitle={
          <>
            Joined {fmtDate(linkRow.joined_at)} · {linkRow.onboarding_method ?? 'unknown'} ·{' '}
            <StatusPill tone={active && left > 0 ? 'on' : 'off'}>
              {active && left > 0 ? `${left} days left` : active?.status ?? 'no plan'}
            </StatusPill>
          </>
        }
        actions={
          <ButtonLink href="/admin/members" variant="ghost" size="sm" leadingIcon={<ArrowLeft size={16} strokeWidth={1.75} />}>
            Back to members
          </ButtonLink>
        }
      />

      {active && (
        <Card>
          <CardHeader title="Current membership" />
          <div style={{ padding: 18 }}>
            <MemberAdminActions slug={slug} membershipId={active.id} status={active.status ?? 'active'} />
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Profile" />
        <dl className="gf-detail-list">
          <div>
            <dt>Email</dt>
            <dd>{profile?.email ?? '—'}</dd>
          </div>
          <div>
            <dt>Phone</dt>
            <dd>{profile?.phone ?? '—'}</dd>
          </div>
          <div>
            <dt>Date of birth</dt>
            <dd>{profile?.date_of_birth ? fmtDate(profile.date_of_birth) : '—'}</dd>
          </div>
          <div>
            <dt>Gender</dt>
            <dd>{profile?.gender ?? '—'}</dd>
          </div>
          <div>
            <dt>Address</dt>
            <dd>{profile?.address ?? '—'}</dd>
          </div>
          <div>
            <dt>Next of kin</dt>
            <dd>
              {profile?.nok_name ?? '—'}{profile?.nok_relationship ? ` (${profile.nok_relationship})` : ''}
              {profile?.nok_phone ? ` · ${profile.nok_phone}` : ''}
            </dd>
          </div>
          <div>
            <dt>Health notes</dt>
            <dd style={{ whiteSpace: 'pre-wrap', textAlign: 'right' }}>{profile?.health_notes ?? '—'}</dd>
          </div>
          <div>
            <dt>Waiver signed</dt>
            <dd>{profile?.waiver_signed_at ? fmtDate(profile.waiver_signed_at) : 'No'}</dd>
          </div>
        </dl>
      </Card>

      <Card>
        <CardHeader title="Tags & staff notes" />
        <TagsAndNotesCard
          slug={slug}
          memberId={id}
          initialTags={tags}
          initialNotes={linkRow.staff_notes}
        />
      </Card>

      <Card>
        <CardHeader title="Subscription history" />
        {memberships && memberships.length > 0 ? (
          <div className="gf-table-wrap">
            <table className="gf-table gf-table-cards">
              <thead><tr><th>Plan</th><th>Start</th><th>End</th><th>Status</th></tr></thead>
              <tbody>
                {memberships.map((m) => {
                  const plan = Array.isArray(m.membership_plans) ? m.membership_plans[0] : m.membership_plans;
                  return (
                    <tr key={m.id}>
                      <td>{plan?.name ?? '—'}</td>
                      <td>{fmtDate(m.start_date)}</td>
                      <td>{fmtDate(m.end_date)}</td>
                      <td><span className={`status-pill ${m.status === 'active' ? 'on' : 'off'}`}>{m.status}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={ClipboardList} title="No subscriptions" />
        )}
      </Card>

      <Card>
        <CardHeader title="Payments" />
        {payments && payments.length > 0 ? (
          <div className="gf-table-wrap">
            <table className="gf-table gf-table-cards">
              <thead><tr><th>Date</th><th>Plan</th><th>Method</th><th>Amount</th><th>Status</th></tr></thead>
              <tbody>
                {payments.map((p) => {
                  const plan = Array.isArray(p.membership_plans) ? p.membership_plans[0] : p.membership_plans;
                  return (
                    <tr key={p.id}>
                      <td>{p.payment_date ? fmtDateTime(p.payment_date) : '—'}</td>
                      <td>{plan?.name ?? '—'}</td>
                      <td>{p.payment_method ?? '—'}</td>
                      <td>{fmtNaira(p.amount)}</td>
                      <td><span className={`status-pill ${p.payment_status === 'successful' ? 'on' : 'off'}`}>{p.payment_status}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={Banknote} title="No payments yet" />
        )}
      </Card>

      <Card>
        <CardHeader title="Recent check-ins" />
        {checkIns && checkIns.length > 0 ? (
          <ul className="gf-list">
            {checkIns.map((c) => (
              <li key={c.id} className="gf-list-row">
                <span>{c.checked_in_at ? fmtDateTime(c.checked_in_at) : '—'}</span>
                <span className="gf-table-meta">{c.check_in_method ?? '—'}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={MapPin} title="No check-ins" />
        )}
      </Card>
    </div>
  );
}
