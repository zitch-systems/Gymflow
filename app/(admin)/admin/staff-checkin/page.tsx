import type { Route } from 'next';
import Link from 'next/link';
import QRCode from 'qrcode';
import { ScanLine, Clock, Users, Search, Download, Printer } from 'lucide-react';
import { requireStaff } from '@/lib/auth/dal';
import { ROOT_DOMAIN } from '@/lib/tenant';
import { createClient } from '@/lib/supabase/server';
import { watDateISO, watDayStartUtc } from '@/lib/format';
import { CheckInButton } from '@/components/admin/checkin-button';
import { CodeRedeem } from '@/components/admin/code-redeem';

export const metadata = { title: 'Check-In' };
export const dynamic = 'force-dynamic';
// Generates a 1024px door-QR data URL on render; give it headroom like the
// other image-producing routes rather than the platform default.
export const maxDuration = 60;

export default async function AdminCheckin({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { gym } = await requireStaff();
  const supabase = await createClient();
  const sp = await searchParams;

  // Real, printable door QR: members scan it to check in (?via=qr auto-checks
  // the signed-in member into their gym). Points at the gym's own branded
  // subdomain (<slug>.gymflow.ng) — matching the invite-page QR codes — rather
  // than the apex, so every printed/shared link stays on the gym's domain.
  const origin = `https://${gym.slug}.${ROOT_DOMAIN}`;
  const checkinUrl = `${origin}/checkin?via=qr`;
  const q = (sp.q ?? '').trim();
  const safe = q.replace(/[(),%*]/g, ' ').trim();

  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  // QR render + the two independent check-in queries in parallel (previously
  // three sequential awaits).
  const [doorQr, { data: feed }, { data: openRows }] = await Promise.all([
    QRCode.toDataURL(checkinUrl, { margin: 2, width: 1024, errorCorrectionLevel: 'M', color: { dark: '#0a0b0e', light: '#ffffff' } }),
    supabase
      .from('check_ins')
      .select('id, checked_in_at, checked_out_at, check_in_method, member_id')
      .eq('gym_id', gym.id)
      .order('checked_in_at', { ascending: false })
      .limit(12),
    // Members currently inside: open visits (no check-out yet) since the start
    // of today (WAT) — powers the KPI and flips result buttons to "Check out".
    supabase
      .from('check_ins')
      .select('member_id')
      .eq('gym_id', gym.id)
      .eq('status', 'active').is('checked_out_at', null)
      .gte('checked_in_at', watDayStartUtc(watDateISO())),
  ]);
  const inGymIds = new Set((openRows ?? []).map((o) => o.member_id).filter(Boolean) as string[]);

  const todayRows = (feed ?? []).filter((c) => c.checked_in_at && new Date(c.checked_in_at) >= dayStart);
  const lastTime = feed?.[0]?.checked_in_at
    ? new Date(feed[0].checked_in_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '—';

  const ids = [...new Set((feed ?? []).map((c) => c.member_id).filter(Boolean) as string[])];
  const { data: profiles } = ids.length
    ? await supabase.from('profiles').select('id, full_name, email').in('id', ids)
    : { data: [] as { id: string; full_name: string | null; email: string | null }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? p.email ?? 'Member']));

  let results: { id: string; full_name: string | null; email: string | null }[] = [];
  if (safe) {
    // One gym-scoped query (links !inner join + trigram-indexed ILIKE). The
    // old two-hop version fetched up to 1000 link rows first, silently
    // missing members beyond the cap in large gyms.
    const { data: matches } = await supabase.from('profiles')
      .select('id, full_name, email, gym_member_links!inner(gym_id)')
      .eq('gym_member_links.gym_id', gym.id)
      .eq('gym_member_links.is_active', true)
      .or(`full_name.ilike.%${safe}%,email.ilike.%${safe}%`)
      .limit(10);
    results = (matches ?? []).map(({ id, full_name, email }) => ({ id, full_name, email }));
  }

  return (
    <>
      <div className="page-h"><div><h1>Check-In</h1><p>{gym.name} · {todayRows.length} member{todayRows.length === 1 ? '' : 's'} in so far today</p></div></div>

      <section className="kpis k3">
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#11d18b1f', color: '#11d18b' }}><ScanLine strokeWidth={1.9} /></div></div><div className="kpi-val">{todayRows.length}</div><div className="kpi-lbl">Check-ins today</div></div>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#4080ff1f', color: '#4080ff' }}><Clock strokeWidth={1.9} /></div></div><div className="kpi-val">{lastTime}</div><div className="kpi-lbl">Last check-in</div></div>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#c6f24e1f', color: '#a8d92e' }}><Users strokeWidth={1.9} /></div></div><div className="kpi-val">{inGymIds.size}</div><div className="kpi-lbl">In gym now</div></div>
      </section>

      <section className="ci-grid">
        <div className="scan">
          <div className="door-qr">
            {/* eslint-disable-next-line @next/next/no-img-element -- generated data-URL QR */}
            <img src={doorQr} alt={`Check-in QR for ${gym.name}`} width={168} height={168} />
          </div>
          <h2>Scan, code, or search</h2>
          <p>Members scan this QR at the entrance, read you a code from their check-in page, or you find them below. Redeeming toggles: it checks members out if they’re already in.</p>
          <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            <a className="gf-btn gf-btn-secondary gf-btn-sm" href={doorQr} download={`gymflow-${gym.slug}-checkin-qr.png`} style={{ textDecoration: 'none' }}>
              <Download strokeWidth={2} size={15} /> Download PNG
            </a>
            <Link
              className="gf-btn gf-btn-primary gf-btn-sm"
              href={`/print-qr/${gym.slug}?type=checkin` as Route}
              target="_blank"
              rel="noreferrer"
              style={{ textDecoration: 'none' }}
            >
              <Printer strokeWidth={2} size={15} /> Print A4 poster
            </Link>
          </div>
          <CodeRedeem />
          <form className="find" method="get" action="/admin/staff-checkin"><Search strokeWidth={1.75} /><input name="q" defaultValue={q} placeholder="Type a member name…" aria-label="Find member" /></form>
          {q && (
            <div className="ci-results">
              {results.length === 0 ? (
                <p style={{ color: 'var(--gf-text-muted)', fontSize: '0.84rem', margin: '14px 0 0' }}>No members match “{q}”.</p>
              ) : results.map((r) => {
                const nm = r.full_name ?? r.email ?? 'Member';
                return (
                  <div className="ci-result" key={r.id}>
                    <span className="gf-avatar gf-avatar-sm">{nm.charAt(0).toUpperCase()}</span>
                    <div className="m"><strong>{nm}</strong><small>{r.email ?? ''}</small></div>
                    <CheckInButton memberId={r.id} checkedIn={inGymIds.has(r.id)} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="panel">
          <div className="panel-h"><div><h3>Today&apos;s check-ins</h3><div className="sub"><span className="gf-status-dot active">Live</span></div></div></div>
          {(feed ?? []).length === 0 ? (
            <div className="empty"><div className="eic"><ScanLine strokeWidth={1.6} /></div><h3>No check-ins yet</h3><p>Members appear here as they arrive.</p></div>
          ) : (
            <div className="feed">
              {(feed ?? []).map((c) => {
                const nm = c.member_id ? (nameById.get(c.member_id) ?? 'Member') : 'Member';
                const fmt = (iso: string) => new Date(iso).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: false });
                const t = c.checked_in_at ? fmt(c.checked_in_at) : '—';
                const out = c.checked_out_at ? fmt(c.checked_out_at) : null;
                return (
                  <div className="feed-row" key={c.id}>
                    <span className="gf-avatar gf-avatar-sm">{nm.charAt(0).toUpperCase()}</span>
                    <span className="feed-meta"><strong>{nm}</strong><small>{c.check_in_method ?? 'QR'} · {out ? 'checked out' : 'in gym'}</small></span>
                    <span className="feed-time">{t}{out ? ` – ${out}` : ''}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
