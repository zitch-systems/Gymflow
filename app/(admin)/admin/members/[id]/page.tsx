import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft, Mail, Phone, CalendarDays, Wallet, Activity, CreditCard, ScanLine,
  ShieldCheck, HeartPulse, MapPin, Cake, UserRound, Clock, BadgeCheck,
} from 'lucide-react';
import { requireStaff } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDate, daysLeft, watDateISO, watDayStartUtc } from '@/lib/format';
import { MemberActions } from '@/components/admin/member-actions';
import { FreezeActions } from '@/components/admin/freeze-actions';
import { AutoRenewAction } from '@/components/admin/auto-renew-action';

export const metadata = { title: 'Member' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PAID = new Set(['success', 'successful', 'completed', 'paid']);

function payBadge(status: string): [string, string] {
  const s = status.toLowerCase();
  if (PAID.has(s)) return ['gf-badge-success', 'Paid'];
  if (s === 'pending') return ['gf-badge-warning', 'Pending'];
  if (s === 'refunded') return ['gf-badge-brand', 'Refunded'];
  return ['gf-badge-danger', 'Failed'];
}

function timeOf(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function duration(a: string | null, b: string | null): string | null {
  if (!a || !b) return null;
  const m = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
  if (m <= 0) return null;
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}

const methodLabel: Record<string, string> = {
  qr: 'QR scan', manual: 'Manual', front_desk: 'Front desk', self: 'Self', code: 'Front-desk code',
  card: 'Card', bank_transfer: 'Bank transfer', cash: 'Cash', crypto: 'Crypto',
};

// id is interpolated into a PostgREST .or() filter below; reject anything that
// isn't a clean UUID so it can't smuggle in extra filter terms.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function MemberDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { gym } = await requireStaff();
  const supabase = await createClient();

  const [{ data: profile }, { data: link }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', id).maybeSingle(),
    supabase.from('gym_member_links').select('*').eq('gym_id', gym.id).or(`member_id.eq.${id},user_id.eq.${id}`).maybeSingle(),
  ]);
  if (!profile || !link) notFound();

  const [{ data: subs }, { data: payments }, { data: checkIns }, { data: plans }, { count: visitCount }] = await Promise.all([
    supabase.from('member_subscriptions').select('*').eq('gym_id', gym.id).eq('member_id', id).order('end_date', { ascending: false }),
    supabase.from('payments').select('*').eq('gym_id', gym.id).eq('member_id', id).order('payment_date', { ascending: false }).limit(100),
    supabase.from('check_ins').select('*').eq('gym_id', gym.id).eq('member_id', id).order('checked_in_at', { ascending: false }).limit(60),
    supabase.from('membership_plans').select('id, name, price').eq('gym_id', gym.id),
    supabase.from('check_ins').select('id', { count: 'exact', head: true }).eq('gym_id', gym.id).eq('member_id', id),
  ]);

  const planById = new Map((plans ?? []).map((p) => [p.id, p]));
  const pays = payments ?? [];
  const cins = checkIns ?? [];
  const subList = subs ?? [];

  // Currently inside? (open visit today, WAT) — flips Quick actions to "Check out".
  const dayStartIso = watDayStartUtc(watDateISO());
  const checkedIn = cins.some((c) => c.status === 'active' && !c.checked_out_at && (c.checked_in_at ?? '') >= dayStartIso);

  const name = profile.full_name || [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email || 'Member';
  const initial = name.charAt(0).toUpperCase();

  const today = new Date().toISOString().slice(0, 10);
  const activeSub = subList.find((s) => s.status === 'active' && (s.end_date ?? '') >= today) ?? subList[0] ?? null;
  const remaining = activeSub?.end_date ? daysLeft(activeSub.end_date) : 0;
  const isActive = Boolean(activeSub && activeSub.status === 'active' && (activeSub.end_date ?? '') >= today);
  const statusBadge: [string, string] = isActive
    ? (remaining <= 7 ? ['gf-badge-warning', `Expiring · ${remaining}d`] : ['gf-badge-success', 'Active'])
    : (activeSub ? ['gf-badge-danger', 'Expired'] : ['gf-badge', 'No plan']);

  const totalSpent = pays.filter((p) => PAID.has(String(p.status ?? p.payment_status ?? '').toLowerCase())).reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const visits = visitCount ?? cins.length;
  const memberNo = profile.member_id || `#${id.slice(0, 8).toUpperCase()}`;

  const STATS = [
    { icon: Wallet, fg: '#11d18b', bg: '#11d18b1f', val: fmtNaira(totalSpent), lbl: 'Total spent' },
    { icon: Activity, fg: '#4080ff', bg: '#4080ff1f', val: String(visits), lbl: 'Total visits' },
    { icon: CreditCard, fg: '#c6f24e', bg: '#c6f24e24', val: String(pays.length), lbl: 'Payments' },
    { icon: CalendarDays, fg: '#ffb020', bg: '#ffb0201f', val: link.joined_at ? fmtDate(link.joined_at) : '—', lbl: 'Member since' },
  ];

  const details: { icon: typeof Mail; label: string; value: string | null }[] = [
    { icon: Mail, label: 'Email', value: profile.email },
    { icon: Phone, label: 'Phone', value: profile.phone },
    { icon: Cake, label: 'Date of birth', value: profile.date_of_birth ? fmtDate(profile.date_of_birth) : null },
    { icon: UserRound, label: 'Gender', value: profile.gender },
    { icon: MapPin, label: 'Address', value: profile.address },
    { icon: HeartPulse, label: 'Emergency contact', value: profile.emergency_contact_name ? `${profile.emergency_contact_name}${profile.emergency_contact_phone ? ` · ${profile.emergency_contact_phone}` : ''}` : (profile.nok_name ? `${profile.nok_name}${profile.nok_phone ? ` · ${profile.nok_phone}` : ''}${profile.nok_relationship ? ` (${profile.nok_relationship})` : ''}` : null) },
    { icon: ShieldCheck, label: 'Waiver', value: profile.waiver_signed_at ? `Signed ${fmtDate(profile.waiver_signed_at)}` : 'Not signed' },
    { icon: HeartPulse, label: 'Health notes', value: profile.health_notes },
  ];
  const shownDetails = details.filter((d) => d.value);

  return (
    <>
      <Link href="/admin/members" className="back-link"><ArrowLeft strokeWidth={2} size={16} /> Back to members</Link>

      <div className="mdh">
        <span className="gf-avatar gf-avatar-xl">{initial}</span>
        <div className="mdh-id">
          <div className="mdh-name"><h1>{name}</h1><span className={`gf-badge ${statusBadge[0]}`}>{statusBadge[1]}</span></div>
          <div className="mdh-meta">
            <span><BadgeCheck strokeWidth={1.8} size={14} /> {memberNo}</span>
            {profile.email && <span><Mail strokeWidth={1.8} size={14} /> {profile.email}</span>}
            {profile.phone && <span><Phone strokeWidth={1.8} size={14} /> {profile.phone}</span>}
          </div>
        </div>
        <div className="mdh-actions">
          {profile.email && <a className="gf-btn gf-btn-secondary gf-btn-sm" href={`mailto:${profile.email}`}><Mail strokeWidth={1.9} size={15} /> Email</a>}
          {profile.phone && <a className="gf-btn gf-btn-secondary gf-btn-sm" href={`tel:${profile.phone}`}><Phone strokeWidth={1.9} size={15} /> Call</a>}
        </div>
      </div>

      <section className="kpis">
        {STATS.map((k) => {
          const Icon = k.icon;
          return (
            <div className="kpi" key={k.lbl}>
              <div className="kpi-top"><div className="kpi-ic" style={{ background: k.bg, color: k.fg }}><Icon strokeWidth={1.9} /></div></div>
              <div className="kpi-val">{k.val}</div>
              <div className="kpi-lbl">{k.lbl}</div>
            </div>
          );
        })}
      </section>

      <MemberActions
        memberId={id}
        isActive={Boolean(link.is_active)}
        checkedIn={checkedIn}
        plans={(plans ?? []).map((p) => ({ id: p.id, name: p.name ?? 'Plan', price: Number(p.price ?? 0) }))}
      />

      <FreezeActions
        sub={(() => {
          const s = subList.find((x) => x.status === 'pause_requested' || x.status === 'paused');
          return s ? { id: s.id, status: s.status ?? '', paused_at: s.paused_at, pause_reason: s.pause_reason } : null;
        })()}
      />

      <AutoRenewAction
        subId={activeSub?.id ?? null}
        on={Boolean(activeSub?.auto_debit_enabled && activeSub?.paystack_subscription_code)}
      />

      <div className="md-grid">
        <div className="md-col">
          <div className="panel">
            <div className="panel-h"><h3>Membership</h3></div>
            {activeSub ? (
              <div className="md-sub">
                <div className="md-sub-top">
                  <div><strong>{activeSub.plan_id ? planById.get(activeSub.plan_id)?.name ?? 'Plan' : 'Plan'}</strong><small>{isActive ? `${remaining} day${remaining === 1 ? '' : 's'} left` : 'Expired'}</small></div>
                  <span className={`gf-badge ${statusBadge[0]}`}>{statusBadge[1]}</span>
                </div>
                <div className="md-sub-rows">
                  <div><span>Start</span><b>{fmtDate(activeSub.start_date)}</b></div>
                  <div><span>Renews</span><b>{fmtDate(activeSub.end_date)}</b></div>
                  <div><span>Payment method</span><b>{activeSub.payment_method ? (methodLabel[activeSub.payment_method] ?? activeSub.payment_method) : '—'}</b></div>
                  <div><span>Auto-debit</span><b>{activeSub.auto_debit_enabled ? 'On' : 'Off'}</b></div>
                </div>
                {subList.length > 1 && <div className="md-sub-hist">{subList.length} subscription{subList.length === 1 ? '' : 's'} on record</div>}
              </div>
            ) : (
              <div className="empty sm"><div className="eic"><Wallet strokeWidth={1.6} /></div><h3>No membership</h3><p>This member has no subscription yet.</p></div>
            )}
          </div>

          <div className="panel">
            <div className="panel-h"><h3>Personal details</h3></div>
            {shownDetails.length ? (
              <div className="infolist">
                {shownDetails.map((d) => {
                  const Icon = d.icon;
                  return (
                    <div className="info-row" key={d.label}>
                      <span className="info-ic"><Icon strokeWidth={1.8} size={16} /></span>
                      <span className="info-lbl">{d.label}</span>
                      <span className="info-val">{d.value}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="empty sm"><h3>No details on file</h3><p>This member hasn’t added profile details.</p></div>
            )}
          </div>
        </div>

        <div className="md-col">
          <div className="panel">
            <div className="panel-h"><h3>Payment history</h3><span className="sub">{pays.length} payment{pays.length === 1 ? '' : 's'} · {fmtNaira(totalSpent)} collected</span></div>
            {pays.length ? (
              <table className="tbl">
                <thead><tr><th>Date</th><th>Plan</th><th>Method</th><th>Status</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                <tbody>
                  {pays.map((p) => {
                    const badge = payBadge(String(p.status ?? p.payment_status ?? ''));
                    return (
                      <tr key={p.id}>
                        <td><div className="cell-2"><strong>{fmtDate(p.payment_date ?? p.created_at)}</strong><small>{p.paystack_reference ?? '—'}</small></div></td>
                        <td>{p.plan_id ? planById.get(p.plan_id)?.name ?? '—' : '—'}</td>
                        <td style={{ color: 'var(--gf-text-secondary)' }}>{p.payment_method ? (methodLabel[p.payment_method] ?? p.payment_method) : '—'}</td>
                        <td><span className={`gf-badge ${badge[0]}`}>{badge[1]}</span></td>
                        <td className="naira" style={{ textAlign: 'right' }}>{fmtNaira(Number(p.amount ?? 0))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="empty sm"><div className="eic"><CreditCard strokeWidth={1.6} /></div><h3>No payments yet</h3><p>Payments show here once this member is billed.</p></div>
            )}
          </div>

          <div className="panel">
            <div className="panel-h"><h3>Check-in history</h3><span className="sub">{visits} total visit{visits === 1 ? '' : 's'}</span></div>
            {cins.length ? (
              <div className="ci-list">
                {cins.map((c) => {
                  const d = duration(c.checked_in_at, c.checked_out_at);
                  return (
                    <div className="ci-item" key={c.id}>
                      <span className="ci-ic"><ScanLine strokeWidth={1.8} size={16} /></span>
                      <div className="ci-m"><strong>{fmtDate(c.checked_in_at)}</strong><small>{timeOf(c.checked_in_at)}{d ? ` · ${d}` : ''} · {c.check_in_method ? (methodLabel[c.check_in_method] ?? c.check_in_method) : 'Check-in'}</small></div>
                      {c.status === 'overstay'
                        ? <span className="gf-badge gf-badge-warning">Overstay</span>
                        : <span className="ci-time"><Clock strokeWidth={1.8} size={13} /> {timeOf(c.checked_in_at)}</span>}
                    </div>
                  );
                })}
                {visits > cins.length && <div className="md-sub-hist">Showing {cins.length} of {visits}</div>}
              </div>
            ) : (
              <div className="empty sm"><div className="eic"><Activity strokeWidth={1.6} /></div><h3>No check-ins yet</h3><p>Visits appear here when this member checks in.</p></div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
