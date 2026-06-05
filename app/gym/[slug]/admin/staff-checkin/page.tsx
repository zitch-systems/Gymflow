import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime } from '@/lib/format';
import { StaffCheckInForm } from './staff-checkin-form';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Stat } from '@/components/ui/stat';
import { ClipboardList, QrCode, ScanLine, Clock4, TrendingUp, Check } from 'lucide-react';
import { startOfTodayIso } from '@/lib/dates';

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ member?: string }>;
};

export default async function StaffCheckInPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const { gym } = await requireStaff(slug);

  const supabase = await createClient();
  const startOfDay = startOfTodayIso();

  const { data: recent } = await supabase
    .from('check_ins')
    .select('id, member_id, checked_in_at, check_in_method')
    .eq('gym_id', gym.id)
    .gte('checked_in_at', startOfDay)
    .order('checked_in_at', { ascending: false })
    .limit(50);

  const memberIds = Array.from(new Set((recent ?? []).map((c) => c.member_id).filter(Boolean) as string[]));
  const profilesPromise =
    memberIds.length > 0
      ? supabase.from('profiles').select('id, full_name, first_name, last_name, email, phone').in('id', memberIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null; first_name: string | null; last_name: string | null; email: string | null; phone: string | null }> });
  const { data: profiles } = await profilesPromise;
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  // KPIs computed from today's feed (no extra queries).
  const checkInsToday = recent?.length ?? 0;
  const last = recent?.[0];
  const lastTime = last?.checked_in_at
    ? new Date(last.checked_in_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '—';

  // Peak hour today — find the busiest single hour in today's check-ins.
  const hourCounts = new Map<number, number>();
  for (const c of recent ?? []) {
    if (!c.checked_in_at) continue;
    const h = new Date(c.checked_in_at).getHours();
    hourCounts.set(h, (hourCounts.get(h) ?? 0) + 1);
  }
  let peakHour = -1;
  let peakCount = 0;
  for (const [h, n] of hourCounts) {
    if (n > peakCount) { peakHour = h; peakCount = n; }
  }
  const peakLabel = peakHour >= 0 ? `${peakHour}–${peakHour + 1}` : '—';

  const todayLabel = new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="gf-page">
      <PageHeader
        title="Check-in"
        subtitle={`${todayLabel} · ${checkInsToday} member${checkInsToday === 1 ? '' : 's'} in so far today`}
      />

      <div className="adm-checkin-kpis">
        <Stat label="Check-ins today" value={checkInsToday} accent="emerald" icon={ScanLine} />
        <Stat label="Last check-in" value={lastTime} accent="blue" icon={Clock4} />
        <Stat label={`Peak hour${peakCount > 0 ? ` (${peakCount})` : ''}`} value={peakLabel} accent="purple" icon={TrendingUp} />
      </div>

      <div className="adm-checkin-grid">
        <div className="adm-checkin-scan">
          <div className="adm-checkin-ring" aria-hidden>
            <QrCode strokeWidth={1.75} />
          </div>
          <h2>Scan or search to check in</h2>
          <p>Members scan the door QR, or paste a member ID below to check them in manually.</p>
          <StaffCheckInForm slug={slug} defaultMember={sp.member ?? ''} />
        </div>

        <Card>
          <CardHeader title="Today's check-ins" />
          {recent && recent.length > 0 ? (
            <div className="adm-feed">
              {recent.map((c) => {
                const p = c.member_id ? profileById.get(c.member_id) : null;
                const composed = [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim();
                const name = p?.full_name || composed || c.member_id?.slice(0, 8) || 'Member';
                const initial = name.charAt(0).toUpperCase();
                const method = c.check_in_method === 'self' ? 'QR · Self check-in'
                  : c.check_in_method === 'staff' ? 'Front desk'
                  : c.check_in_method === 'manual' ? 'Front desk'
                  : c.check_in_method ?? 'Check-in';
                return (
                  <div key={c.id} className="adm-feed-row">
                    <span className="adm-feed-av" aria-hidden>
                      {c.check_in_method === 'self' ? <Check size={14} strokeWidth={2.5} /> : initial}
                    </span>
                    <span className="adm-feed-m">
                      <strong>{name}</strong>
                      <small>{method}</small>
                    </span>
                    <span className="adm-feed-t">{fmtDateTime(c.checked_in_at)}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState icon={ClipboardList} title="No check-ins yet" message="Check-ins appear here as members arrive." />
          )}
        </Card>
      </div>
    </div>
  );
}
