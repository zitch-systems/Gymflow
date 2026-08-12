import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import {
  ArrowLeft, ExternalLink, Globe, Mail, Phone, MapPin, Clock, Coins, Users, Activity,
  Wallet, CreditCard, CalendarDays, Dumbbell, Landmark, ShieldCheck, ScrollText,
  LifeBuoy, Check, X, Building2, BadgeCheck, Layers,
} from 'lucide-react';
import { requirePlatformAdmin } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDate, fmtDateTime, initialsOf, roleLabel } from '@/lib/format';
import {
  gymBillingState, PLATFORM_PLANS, isPlanTier, normalizeCycle, planAmountKobo,
  monthlyEquivalentKobo, CYCLE_SUFFIX, type BillingState, type PlanTier,
} from '@/lib/platform-plans';
import { ROOT_DOMAIN } from '@/lib/tenant';
import { CommissionEditor } from '@/components/superadmin/commission-editor';
import { GymControls } from '@/components/superadmin/gym-controls';

export const metadata = { title: 'Gym' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PAID = new Set(['success', 'successful', 'completed', 'paid']);

// gymBillingState() already folds trial_ends_at and the paid-through date into
// one value, so the badge reads off that rather than the raw column — a gym
// whose trial lapsed shows "Trial expired", not "Trial".
const BILLING_BADGE: Record<BillingState, [string, string]> = {
  active: ['gf-badge-success', 'Active'],
  trial: ['gf-badge-warning', 'On trial'],
  trial_expired: ['gf-badge-danger', 'Trial expired'],
  past_due: ['gf-badge-danger', 'Past due'],
  cancelling: ['gf-badge-warning', 'Cancelling'],
  cancelled: ['gf-badge-neutral', 'Cancelled'],
  suspended: ['gf-badge-danger', 'Billing suspended'],
};

const PAYOUT_BADGE: Record<string, [string, string]> = {
  pending: ['gf-badge-warning', 'Pending'],
  approved: ['gf-badge-brand', 'Approved'],
  paid: ['gf-badge-success', 'Paid'],
  rejected: ['gf-badge-danger', 'Rejected'],
  failed: ['gf-badge-danger', 'Failed'],
};

const TICKET_BADGE: Record<string, [string, string]> = {
  open: ['gf-badge-warning', 'Open'],
  pending: ['gf-badge-warning', 'Pending'],
  closed: ['gf-badge-neutral', 'Closed'],
  resolved: ['gf-badge-success', 'Resolved'],
};

/** Monthly-equivalent price, so a 12-month membership contributes a twelfth of
 *  its price to MRR rather than the whole thing. */
function perMonth(price: number | null, months: number | null, days: number | null): number {
  const p = Number(price ?? 0);
  if (!p) return 0;
  const m = months ?? (days ? days / 30 : null);
  return m && m > 0 ? p / m : p;
}

/** Rows the platform operator needs to see but must not be able to read in
 *  full — bank account numbers on a cross-tenant screen. */
function maskAccount(n: string | null): string {
  if (!n) return '—';
  return n.length <= 4 ? `••••${n}` : `••••${n.slice(-4)}`;
}

// The gym profile columns that postdate lib/database.types.ts (added by
// 20260730_gym_public_page.sql). Same `as never`/cast pattern the rest of the
// app uses for them; the row itself comes back from select('*').
type ExtraGymCols = {
  accent_color: string | null; accent_ink: string | null; capacity: number | null;
  day_pass_price: number | null; joining_fee: number | null; payouts_locked: boolean | null;
  brand_color: string | null; social_links: Record<string, string> | null;
};

type PayoutAccount = {
  id: string; bank_name: string | null; account_number: string | null; account_name: string | null;
  verified: boolean | null; is_active: boolean | null; paystack_subaccount_code: string | null;
};

// ── One gym, everything the platform knows about it ──────────────────────────
// Reached by clicking a row in /superadmin/gyms. The prototype
// (design/revamp/superadmin-gyms.html) sketched a 420px drawer with four stats;
// a deep-linkable page is used instead so an operator can share the URL, and so
// the panels below (billing history, payouts, audit, support) have somewhere to
// live. Read-only except for the Platform controls panel.
export default async function SuperGymDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  await requirePlatformAdmin();
  const supabase = await createClient();

  const { data: gymRow } = await supabase.from('gyms').select('*').eq('id', id).maybeSingle();
  if (!gymRow) notFound();
  const gym = gymRow;
  const extra = gymRow as unknown as ExtraGymCols;

  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [
    { data: memberLinks }, { data: staffLinks }, { data: plans }, { count: classCount },
    { count: checkIns30 }, { data: payments }, { data: platPay }, { data: subs },
    { data: payoutAccounts }, { data: payouts }, { count: zoneCount }, { count: hoursCount },
    { data: audit }, { data: tickets },
  ] = await Promise.all([
    supabase.from('gym_member_links').select('member_id, user_id, joined_at, is_active, status').eq('gym_id', id).order('joined_at', { ascending: false }).limit(400),
    supabase.from('gym_staff_links').select('user_id, role, is_active, joined_at, created_at').eq('gym_id', id).order('created_at', { ascending: true }),
    supabase.from('membership_plans').select('id, name, price, duration_months, duration_days, is_active').eq('gym_id', id).order('price', { ascending: true }),
    supabase.from('classes').select('id', { count: 'exact', head: true }).eq('gym_id', id).eq('is_active', true),
    supabase.from('check_ins').select('id', { count: 'exact', head: true }).eq('gym_id', id).gte('checked_in_at', monthAgo),
    supabase.from('payments').select('id, amount, status, payment_status, payment_date, created_at, paystack_reference, plan_id, payment_method').eq('gym_id', id).order('payment_date', { ascending: false }).limit(200),
    supabase.from('platform_payments').select('id, amount, plan, payment_status, paystack_reference, billing_period_start, billing_period_end, created_at').eq('gym_id', id).order('created_at', { ascending: false }).limit(12),
    supabase.from('member_subscriptions').select('plan_id, status, end_date').eq('gym_id', id).eq('status', 'active'),
    supabase.from('gym_payout_accounts' as never).select('id, bank_name, account_number, account_name, verified, is_active, paystack_subaccount_code').eq('gym_id', id),
    supabase.from('instructor_payouts').select('id, amount, status, requested_at, instructor_id').eq('gym_id', id).order('requested_at', { ascending: false }).limit(10),
    supabase.from('gym_zones' as never).select('id', { count: 'exact', head: true }).eq('gym_id', id),
    supabase.from('business_hours').select('id', { count: 'exact', head: true }).eq('gym_id', id),
    supabase.from('audit_logs').select('id, action, table_name, actor_id, created_at, record_id').eq('gym_id', id).order('created_at', { ascending: false }).limit(12),
    supabase.from('support_tickets').select('id, subject, status, priority, created_at').eq('gym_id', id).order('created_at', { ascending: false }).limit(8),
  ]);

  const links = memberLinks ?? [];
  const activeMembers = links.filter((l) => l.is_active).length;
  const newMembers30 = links.filter((l) => (l.joined_at ?? '') >= monthAgo).length;
  const staff = (staffLinks ?? []).filter((s) => s.is_active !== false);
  const planList = plans ?? [];
  const planById = new Map(planList.map((p) => [p.id, p]));
  const accounts = ((payoutAccounts ?? []) as unknown as PayoutAccount[]);

  // Member-side MRR: monthly equivalent of the gym's currently-active
  // memberships. This is the gym's revenue, NOT GymFlow's — the platform earns
  // the subscription plus its commission on these.
  const memberMrr = (subs ?? []).reduce((s, r) => {
    const p = r.plan_id ? planById.get(r.plan_id) : null;
    return s + (p ? perMonth(p.price, p.duration_months, p.duration_days) : 0);
  }, 0);

  const pays = payments ?? [];
  const paidPays = pays.filter((p) => PAID.has(String(p.status ?? p.payment_status ?? '').toLowerCase()));
  const memberGmv = paidPays.reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const commissionEarned = memberGmv * (Number(gym.platform_commission_pct ?? 0) / 100);

  const platPaid = (platPay ?? []).filter((p) => String(p.payment_status ?? '') === 'successful');
  const platCollected = platPaid.reduce((s, p) => s + Number(p.amount ?? 0), 0);

  const pendingPayouts = (payouts ?? []).filter((p) => p.status === 'pending');
  const pendingPayoutTotal = pendingPayouts.reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const openTickets = (tickets ?? []).filter((t) => t.status === 'open' || t.status === 'pending').length;

  // Names for the staff / member / audit lists. profiles is readable
  // cross-tenant for a platform admin (can_see_profile), same as
  // /superadmin/members.
  const peopleIds = [...new Set([
    ...staff.map((s) => s.user_id),
    ...links.slice(0, 8).map((l) => l.member_id ?? l.user_id),
    ...(audit ?? []).map((a) => a.actor_id),
    ...(payouts ?? []).map((p) => p.instructor_id),
  ].filter((v): v is string => !!v))];
  const { data: people } = peopleIds.length
    ? await supabase.from('profiles').select('id, full_name, email').in('id', peopleIds)
    : { data: [] as { id: string; full_name: string | null; email: string | null }[] };
  const personById = new Map((people ?? []).map((p) => [p.id, p]));
  const nameOf = (uid: string | null) => {
    if (!uid) return '—';
    const p = personById.get(uid);
    return p?.full_name?.trim() || p?.email || `${uid.slice(0, 8)}…`;
  };

  const state = gymBillingState(gym);
  const billing = BILLING_BADGE[state];
  const suspended = gym.status === 'suspended';
  const tier = isPlanTier(gym.subscription_plan ?? '') ? (gym.subscription_plan as PlanTier) : null;
  const cycle = normalizeCycle(gym.subscription_billing_cycle);
  const planName = tier ? PLATFORM_PLANS[tier].name : null;
  // Normalised to a month so this gym is comparable with the platform-wide MRR
  // on /superadmin/revenue, which does the same.
  const platformMrr = state === 'active' && tier ? monthlyEquivalentKobo(tier, cycle) / 100 : 0;
  const host = `${gym.slug}.${ROOT_DOMAIN}`;

  const KPIS = [
    { icon: Users, fg: '#11d18b', bg: '#11d18b1f', val: String(activeMembers), lbl: `Active members · ${newMembers30} joined in 30d` },
    { icon: Coins, fg: '#4080ff', bg: '#4080ff1f', val: fmtNaira(memberMrr), lbl: 'Member MRR (the gym’s own)' },
    { icon: Activity, fg: '#c6f24e', bg: '#c6f24e24', val: String(checkIns30 ?? 0), lbl: 'Check-ins · last 30 days' },
    { icon: Wallet, fg: '#ffb020', bg: '#ffb0201f', val: fmtNaira(platformMrr), lbl: planName ? `Platform MRR · ${planName}` : 'Platform MRR · no plan' },
  ];

  const profileRows: { icon: typeof Mail; label: string; value: string | null }[] = [
    { icon: Mail, label: 'Email', value: gym.email },
    { icon: Phone, label: 'Phone', value: gym.phone },
    { icon: MapPin, label: 'Address', value: [gym.address, gym.city, gym.state].filter(Boolean).join(', ') || null },
    { icon: Globe, label: 'Website', value: gym.website },
    { icon: BadgeCheck, label: 'Member code', value: gym.member_code },
    { icon: Clock, label: 'Timezone', value: gym.timezone },
    { icon: Coins, label: 'Currency', value: gym.currency },
    { icon: Users, label: 'Member cap', value: gym.max_members ? String(gym.max_members) : 'Unlimited' },
    { icon: Layers, label: 'Floor capacity', value: extra.capacity ? `${extra.capacity} people` : null },
    { icon: Dumbbell, label: 'Instructor revenue share', value: `${Number(gym.instructor_revenue_share_pct ?? 0)}%` },
    { icon: ShieldCheck, label: 'Member freeze', value: gym.member_freeze_enabled ? 'Enabled' : 'Disabled' },
    { icon: CalendarDays, label: 'Created', value: gym.created_at ? fmtDate(gym.created_at) : null },
  ].filter((r) => r.value);

  // What still stands between this gym and a public page worth linking to.
  // Every item maps to a real column or table — nothing is inferred.
  const readiness: { label: string; done: boolean; hint: string }[] = [
    { label: 'Logo', done: !!gym.logo_url, hint: 'Settings → Branding' },
    { label: 'Hero image', done: !!gym.hero_image_url, hint: 'Settings → Branding' },
    { label: 'Tagline', done: !!gym.tagline, hint: 'One line under the gym name' },
    { label: 'Description', done: !!gym.description, hint: 'Used for SEO and the About section' },
    { label: 'Accent colour', done: !!extra.accent_color, hint: 'Falls back to GymFlow emerald' },
    { label: 'Address', done: !!gym.address, hint: 'Powers the map and directions link' },
    { label: 'Opening hours', done: (hoursCount ?? 0) > 0, hint: 'Drives the open/closed pill' },
    { label: 'Membership plans', done: planList.some((p) => p.is_active !== false), hint: 'The pricing section is hidden without one' },
    { label: 'Training zones', done: (zoneCount ?? 0) > 0, hint: 'Zones section is hidden without any' },
    { label: 'Floor capacity', done: extra.capacity != null, hint: 'Live-occupancy bar is hidden without it' },
    { label: 'Day pass price', done: extra.day_pass_price != null, hint: 'Optional hero fact' },
    { label: 'Payouts connected', done: !!gym.paystack_subaccount_code, hint: 'Needed before members can pay online' },
  ];
  const readyCount = readiness.filter((r) => r.done).length;

  return (
    <>
      <Link href="/superadmin/gyms" className="back-link"><ArrowLeft strokeWidth={2} size={16} /> Back to gyms</Link>

      <div className="mdh">
        <span className="gf-avatar gf-avatar-xl" style={gym.logo_url ? { overflow: 'hidden', padding: 0 } : undefined}>
          {gym.logo_url
            ? <Image src={gym.logo_url} alt="" width={70} height={70} style={{ objectFit: 'cover', width: '100%', height: '100%' }} />
            : initialsOf(gym.name, 'G')}
        </span>
        <div className="mdh-id">
          <div className="mdh-name">
            <h1>{gym.name}</h1>
            <span className={`gf-badge ${billing[0]}`}><span className="gf-dot" />{billing[1]}</span>
            {suspended && <span className="gf-badge gf-badge-danger">Suspended by platform</span>}
            {planName && <span className="gf-badge gf-badge-brand">{planName}</span>}
          </div>
          <div className="mdh-meta">
            <span><Globe strokeWidth={1.8} size={14} /> {host}</span>
            {gym.city && <span><MapPin strokeWidth={1.8} size={14} /> {gym.city}{gym.state ? `, ${gym.state}` : ''}</span>}
            {gym.created_at && <span><CalendarDays strokeWidth={1.8} size={14} /> Joined {fmtDate(gym.created_at)}</span>}
          </div>
        </div>
        <div className="mdh-actions">
          <a className="gf-btn gf-btn-secondary gf-btn-sm" href={`/g/${gym.slug}`} target="_blank" rel="noreferrer">
            <ExternalLink strokeWidth={1.9} size={15} /> Public page
          </a>
          {gym.email && <a className="gf-btn gf-btn-secondary gf-btn-sm" href={`mailto:${gym.email}`}><Mail strokeWidth={1.9} size={15} /> Email owner</a>}
        </div>
      </div>

      <section className="kpis">
        {KPIS.map((k) => { const Icon = k.icon; return (
          <div className="kpi" key={k.lbl}>
            <div className="kpi-top"><div className="kpi-ic" style={{ background: k.bg, color: k.fg }}><Icon strokeWidth={1.9} /></div></div>
            <div className="kpi-val">{k.val}</div>
            <div className="kpi-lbl">{k.lbl}</div>
          </div>
        ); })}
      </section>

      <GymControls
        gymId={gym.id}
        suspended={suspended}
        plan={gym.subscription_plan ?? null}
        subscriptionStatus={gym.subscription_status ?? 'trial'}
      />

      <div className="md-grid">
        <div className="md-col">
          <div className="panel">
            <div className="panel-h"><div><h3>GymFlow subscription</h3><div className="sub">What this gym pays the platform</div></div></div>
            <div className="md-sub-top">
              <div><strong>{planName ?? 'No plan'}</strong><small>{planName ? `${fmtNaira(planAmountKobo(tier!, cycle) / 100)} ${CYCLE_SUFFIX[cycle]}` : 'Not subscribed'}</small></div>
              <span className={`gf-badge ${billing[0]}`}>{billing[1]}</span>
            </div>
            <div className="md-sub-rows">
              <div><span>Trial ends</span><b>{gym.trial_ends_at ? fmtDate(gym.trial_ends_at) : '—'}</b></div>
              <div><span>Paid through</span><b>{gym.subscription_current_period_end ? fmtDate(gym.subscription_current_period_end) : '—'}</b></div>
              <div><span>Collected all-time</span><b className="naira">{fmtNaira(platCollected)}</b></div>
              <div><span>Paystack subscription</span><b>{gym.paystack_subscription_code ? 'Linked' : 'Not linked'}</b></div>
            </div>
            {platPay?.length ? (
              <div className="tbl-scroll" style={{ marginTop: 14 }}>
                <table className="tbl">
                  <thead><tr><th>Period</th><th>Plan</th><th>Status</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                  <tbody>
                    {platPay.map((p) => (
                      <tr key={p.id}>
                        <td><div className="cell-2"><strong>{fmtDate(p.billing_period_start ?? p.created_at)}</strong><small>{p.paystack_reference ?? '—'}</small></div></td>
                        <td style={{ textTransform: 'capitalize' }}>{p.plan ?? '—'}</td>
                        <td><span className={`gf-badge ${p.payment_status === 'successful' ? 'gf-badge-success' : 'gf-badge-danger'}`}>{p.payment_status === 'successful' ? 'Paid' : p.payment_status === 'pending' ? 'Pending' : 'Failed'}</span></td>
                        <td className="naira" style={{ textAlign: 'right' }}>{fmtNaira(Number(p.amount ?? 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="md-sub-hist">No platform charges on record yet.</div>
            )}
          </div>

          <div className="panel">
            <div className="panel-h">
              <div><h3>Commission &amp; payouts</h3><div className="sub">The platform’s cut of member payments</div></div>
            </div>
            <div className="md-sub-rows" style={{ marginBottom: 14 }}>
              {/* Not wrapped in <b> like its neighbours: .md-sub-rows b sets the
                  display font and weight, which the editor's `font: inherit`
                  input would then pick up (and a <form> inside <b> is invalid
                  nesting anyway). */}
              <div><span>Commission rate</span><CommissionEditor gymId={gym.id} pct={Number(gym.platform_commission_pct ?? 0)} /></div>
              <div><span>Earned on member GMV</span><b className="naira">{fmtNaira(commissionEarned)}</b></div>
              <div><span>Paystack subaccount</span><b>{gym.paystack_subaccount_code ? 'Connected' : 'Not connected'}</b></div>
              <div><span>Pending instructor payouts</span><b className="naira">{pendingPayouts.length ? `${fmtNaira(pendingPayoutTotal)} · ${pendingPayouts.length}` : 'None'}</b></div>
            </div>
            {accounts.length ? (
              <div className="infolist">
                {accounts.map((a) => (
                  <div className="info-row" key={a.id}>
                    <span className="info-ic"><Landmark strokeWidth={1.8} size={16} /></span>
                    <span className="info-lbl">{a.bank_name ?? 'Bank'}{a.is_active ? '' : ' (inactive)'}</span>
                    <span className="info-val">{maskAccount(a.account_number)} · {a.verified ? 'Verified' : 'Unverified'}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="md-sub-hist">No payout account on file.</div>
            )}
          </div>

          <div className="panel">
            <div className="panel-h"><div><h3>Gym profile</h3><div className="sub">Settings the gym controls itself</div></div></div>
            <div className="infolist">
              {profileRows.map((r) => { const Icon = r.icon; return (
                <div className="info-row" key={r.label}>
                  <span className="info-ic"><Icon strokeWidth={1.8} size={16} /></span>
                  <span className="info-lbl">{r.label}</span>
                  <span className="info-val">{r.value}</span>
                </div>
              ); })}
            </div>
          </div>

          <div className="panel">
            <div className="panel-h">
              <div><h3>Public page readiness</h3><div className="sub">{readyCount} of {readiness.length} complete</div></div>
              <a className="gf-btn gf-btn-secondary gf-btn-sm" href={`/g/${gym.slug}`} target="_blank" rel="noreferrer"><ExternalLink strokeWidth={1.9} size={14} /> View</a>
            </div>
            <div className="infolist">
              {readiness.map((r) => (
                <div className="info-row" key={r.label}>
                  <span className="info-ic" style={{ color: r.done ? 'var(--gf-success)' : 'var(--gf-text-muted)' }}>
                    {r.done ? <Check strokeWidth={2.4} size={16} /> : <X strokeWidth={2.2} size={16} />}
                  </span>
                  <span className="info-lbl">{r.label}</span>
                  <span className="info-val" style={{ color: r.done ? 'var(--gf-text-secondary)' : 'var(--gf-text-muted)', fontWeight: 400 }}>
                    {r.done ? 'Set' : r.hint}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="md-col">
          <div className="panel">
            <div className="panel-h">
              <div><h3>Team</h3><div className="sub">{staff.length} active staff member{staff.length === 1 ? '' : 's'}</div></div>
            </div>
            {staff.length ? (
              <div className="tbl-scroll">
                <table className="tbl">
                  <thead><tr><th>Name</th><th>Role</th><th style={{ textAlign: 'right' }}>Since</th></tr></thead>
                  <tbody>
                    {staff.map((s) => (
                      <tr key={`${s.user_id}-${s.role}`}>
                        <td><div className="who"><span className="gf-avatar gf-avatar-sm">{initialsOf(nameOf(s.user_id))}</span><div><strong>{nameOf(s.user_id)}</strong><small>{personById.get(s.user_id)?.email ?? ''}</small></div></div></td>
                        <td>{roleLabel(s.role)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--gf-text-muted)' }}>{fmtDate(s.joined_at ?? s.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty sm"><div className="eic"><Users strokeWidth={1.6} /></div><h3>No staff linked</h3><p>Nobody can sign in to this gym’s console yet.</p></div>
            )}
          </div>

          <div className="panel">
            <div className="panel-h">
              <div><h3>Catalogue</h3><div className="sub">What members can buy and book</div></div>
            </div>
            <div className="md-sub-rows" style={{ marginBottom: planList.length ? 14 : 0 }}>
              <div><span>Membership plans</span><b>{planList.length}</b></div>
              <div><span>Active classes</span><b>{classCount ?? 0}</b></div>
              <div><span>Training zones</span><b>{zoneCount ?? 0}</b></div>
              <div><span>Day pass</span><b className="naira">{extra.day_pass_price != null ? fmtNaira(Number(extra.day_pass_price)) : '—'}</b></div>
            </div>
            {planList.length ? (
              <div className="tbl-scroll">
                <table className="tbl">
                  <thead><tr><th>Plan</th><th>Length</th><th style={{ textAlign: 'right' }}>Price</th></tr></thead>
                  <tbody>
                    {planList.map((p) => (
                      <tr key={p.id}>
                        <td><strong>{p.name}</strong>{p.is_active === false && <small style={{ color: 'var(--gf-text-muted)', display: 'block' }}>Inactive</small>}</td>
                        <td style={{ color: 'var(--gf-text-secondary)' }}>{p.duration_months ? `${p.duration_months} month${p.duration_months === 1 ? '' : 's'}` : p.duration_days ? `${p.duration_days} days` : '—'}</td>
                        <td className="naira" style={{ textAlign: 'right' }}>{fmtNaira(Number(p.price ?? 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty sm"><div className="eic"><Dumbbell strokeWidth={1.6} /></div><h3>No plans yet</h3><p>Members can’t subscribe until this gym prices a plan.</p></div>
            )}
          </div>

          <div className="panel">
            <div className="panel-h">
              <div><h3>Member payments</h3><div className="sub">{fmtNaira(memberGmv)} collected · {paidPays.length} payment{paidPays.length === 1 ? '' : 's'}</div></div>
            </div>
            {pays.length ? (
              <div className="tbl-scroll">
                <table className="tbl">
                  <thead><tr><th>Date</th><th>Plan</th><th>Status</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                  <tbody>
                    {pays.slice(0, 10).map((p) => {
                      const paid = PAID.has(String(p.status ?? p.payment_status ?? '').toLowerCase());
                      return (
                        <tr key={p.id}>
                          <td><div className="cell-2"><strong>{fmtDate(p.payment_date ?? p.created_at)}</strong><small>{p.paystack_reference ?? p.payment_method ?? '—'}</small></div></td>
                          <td>{p.plan_id ? planById.get(p.plan_id)?.name ?? '—' : '—'}</td>
                          <td><span className={`gf-badge ${paid ? 'gf-badge-success' : 'gf-badge-danger'}`}>{paid ? 'Paid' : 'Failed'}</span></td>
                          <td className="naira" style={{ textAlign: 'right' }}>{fmtNaira(Number(p.amount ?? 0))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {pays.length > 10 && <div className="md-sub-hist">Showing 10 of {pays.length}</div>}
              </div>
            ) : (
              <div className="empty sm"><div className="eic"><CreditCard strokeWidth={1.6} /></div><h3>No member payments</h3><p>Nothing has been collected through this gym yet.</p></div>
            )}
          </div>

          <div className="panel">
            <div className="panel-h">
              <div><h3>Instructor payouts</h3><div className="sub">{pendingPayouts.length ? `${pendingPayouts.length} awaiting approval` : 'Nothing pending'}</div></div>
              {pendingPayouts.length > 0 && (
                <Link href="/superadmin/payout-approvals" className="gf-btn gf-btn-secondary gf-btn-sm" style={{ textDecoration: 'none' }}>Review</Link>
              )}
            </div>
            {payouts?.length ? (
              <div className="tbl-scroll">
                <table className="tbl">
                  <thead><tr><th>Instructor</th><th>Requested</th><th>Status</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                  <tbody>
                    {payouts.map((p) => {
                      const b = PAYOUT_BADGE[p.status ?? ''] ?? ['gf-badge-neutral', String(p.status ?? '—')];
                      return (
                        <tr key={p.id}>
                          <td><strong>{nameOf(p.instructor_id)}</strong></td>
                          <td style={{ color: 'var(--gf-text-muted)' }}>{fmtDate(p.requested_at)}</td>
                          <td><span className={`gf-badge ${b[0]}`}>{b[1]}</span></td>
                          <td className="naira" style={{ textAlign: 'right' }}>{fmtNaira(Number(p.amount ?? 0))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty sm"><div className="eic"><Wallet strokeWidth={1.6} /></div><h3>No payout requests</h3><p>Instructors at this gym haven’t requested a payout.</p></div>
            )}
          </div>

          <div className="panel">
            <div className="panel-h">
              <div><h3>Support</h3><div className="sub">{openTickets ? `${openTickets} open` : 'No open tickets'}</div></div>
              <Link href="/superadmin/support" className="gf-btn gf-btn-secondary gf-btn-sm" style={{ textDecoration: 'none' }}>Inbox</Link>
            </div>
            {tickets?.length ? (
              <div className="infolist">
                {tickets.map((t) => {
                  const b = TICKET_BADGE[t.status] ?? ['gf-badge-neutral', t.status];
                  return (
                    <div className="info-row" key={t.id} style={{ gridTemplateColumns: '22px 1fr auto' }}>
                      <span className="info-ic"><LifeBuoy strokeWidth={1.8} size={16} /></span>
                      <span><strong style={{ fontWeight: 600 }}>{t.subject}</strong><small style={{ display: 'block', color: 'var(--gf-text-muted)', fontSize: '0.72rem' }}>{fmtDateTime(t.created_at)} · {t.priority}</small></span>
                      <span className={`gf-badge ${b[0]}`}>{b[1]}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="empty sm"><div className="eic"><LifeBuoy strokeWidth={1.6} /></div><h3>No tickets</h3><p>This gym hasn’t raised a support request.</p></div>
            )}
          </div>

          <div className="panel">
            <div className="panel-h">
              <div><h3>Audit trail</h3><div className="sub">Most recent activity on this gym</div></div>
              <Link href="/superadmin/audit" className="gf-btn gf-btn-secondary gf-btn-sm" style={{ textDecoration: 'none' }}>Full log</Link>
            </div>
            {audit?.length ? (
              <div className="infolist">
                {audit.map((a) => (
                  <div className="info-row" key={a.id} style={{ gridTemplateColumns: '22px 1fr auto' }}>
                    <span className="info-ic"><ScrollText strokeWidth={1.8} size={16} /></span>
                    <span>
                      <strong style={{ fontWeight: 600 }}>{a.action.replace(/_/g, ' ')}</strong>
                      <small style={{ display: 'block', color: 'var(--gf-text-muted)', fontSize: '0.72rem' }}>{a.table_name} · {nameOf(a.actor_id)}</small>
                    </span>
                    <span style={{ color: 'var(--gf-text-muted)', fontSize: '0.74rem', whiteSpace: 'nowrap' }}>{fmtDateTime(a.created_at)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty sm"><div className="eic"><Building2 strokeWidth={1.6} /></div><h3>Nothing logged</h3><p>Audited actions on this gym appear here.</p></div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
