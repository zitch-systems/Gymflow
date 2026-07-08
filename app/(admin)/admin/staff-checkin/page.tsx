import { headers } from 'next/headers';
import QRCode from 'qrcode';
import { ScanLine, Clock, Users, Search, Download } from 'lucide-react';
import { requireStaff } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { watDateISO, watDayStartUtc } from '@/lib/format';
import { CheckInButton } from '@/components/admin/checkin-button';
import { CodeRedeem } from '@/components/admin/code-redeem';

export const metadata = { title: 'Check-In' };
export const dynamic = 'force-dynamic';

export default async function AdminCheckin({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { gym } = await requireStaff();
  const supabase = await createClient();
  const sp = await searchParams;

  // Real, printable door QR: members scan it to check in (?via=qr auto-checks
  // the signed-in member into their gym).
  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const host = h.get('host') ?? '';
  const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || (host ? `${proto}://${host}` : '');
  const checkinUrl = `${origin}/checkin?via=qr&g=${gym.slug}`;
  const doorQr = await QRCode.toDataURL(checkinUrl, { margin: 2, width: 1024, errorCorrectionLevel: 'M', color: { dark: '#0a0b0e', light: '#ffffff' } });
  const q = (sp.q ?? '').trim();
  const safe = q.replace(/[(),%*]/g, ' ').trim();

  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const { data: feed } = await supabase
    .from('check_ins')
    .select('id, checked_in_at, checked_out_at, check_in_method, member_id')
    .eq('gym_id', gym.id)
    .order('checked_in_at', { ascending: false })
    .limit(12);

  // Members currently inside: open visits (no check-out yet) since the start
  // of today (WAT) — powers the KPI and flips result buttons to "Check out".
  const { data: openRows } = await supabase
    .from('check_ins')
    .select('member_id')
    .eq('gym_id', gym.id)
    .eq('status', 'active').is('checked_out_at', null)
    .gte('checked_in_at', watDayStartUtc(watDateISO()));
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
    const { data: links } = await supabase.from('gym_member_links').select('member_id, user_id').eq('gym_id', gym.id).eq('is_active', true).limit(1000);
    const mids = [...new Set((links ?? []).map((l) => l.member_id ?? l.user_id).filter(Boolean) as string[])];
    if (mids.length) {
      const { data: matches } = await supabase.from('profiles').select('id, full_name, email').in('id', mids).or(`full_name.ilike.%${safe}%,email.ilike.%${safe}%`).limit(10);
      results = matches ?? [];
    }
  }

  return (
    <>
      <div className="page-h"><div><h1>Check-In</h1><p>{gym.name} · {todayRows.length} member{todayRows.length === 1 ? '' : 's'} in so far today</p></div></div>

      <section className="kpis" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
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
          <a className="gf-btn gf-btn-secondary gf-btn-sm" href={doorQr} download={`gymflow-${gym.slug}-checkin-qr.png`} style={{ textDecoration: 'none', marginBottom: 14 }}>
            <Download strokeWidth={2} size={15} /> Download door QR
          </a>
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
