import Link from 'next/link';
import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';
import { daysAgoIso } from '@/lib/dates';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { UserX } from 'lucide-react';

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ days?: string }>;
};

const WINDOW_OPTIONS = [
  { id: '14', label: 'No visit in 14 days', days: 14 },
  { id: '30', label: 'No visit in 30 days', days: 30 },
  { id: '60', label: 'No visit in 60 days', days: 60 },
  { id: '90', label: 'No visit in 90 days', days: 90 },
] as const;

export default async function LostMembersPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const { gym } = await requireStaff(slug);

  const window = WINDOW_OPTIONS.find((w) => w.id === sp.days) ?? WINDOW_OPTIONS[1]; // default 30
  const supabase = await createClient();

  // Active members of this gym.
  const { data: links } = await supabase
    .from('gym_member_links')
    .select('user_id, joined_at')
    .eq('gym_id', gym.id)
    .eq('is_active', true)
    .eq('status', 'active')
    .limit(2000);

  const memberIds = (links ?? []).map((l) => l.user_id).filter(Boolean) as string[];

  // Check-ins inside the lookback window — anyone in this set has visited
  // recently and is therefore NOT lost.
  const cutoff = daysAgoIso(window.days);
  const { data: recentCheckIns } = memberIds.length
    ? await supabase
        .from('check_ins')
        .select('member_id')
        .eq('gym_id', gym.id)
        .in('member_id', memberIds)
        .gte('checked_in_at', cutoff)
    : { data: [] as { member_id: string | null }[] };

  const recentSet = new Set((recentCheckIns ?? []).map((c) => c.member_id).filter(Boolean) as string[]);
  const lostIds = memberIds.filter((id) => !recentSet.has(id));

  // Pull the lost members' profiles + last visit (might be older than the
  // window, or never).
  const [{ data: profiles }, { data: lastVisits }] = await Promise.all([
    lostIds.length
      ? supabase.from('profiles').select('id, full_name, first_name, last_name, email, phone, photo_url').in('id', lostIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null; first_name: string | null; last_name: string | null; email: string | null; phone: string | null; photo_url: string | null }> }),
    lostIds.length
      ? supabase
          .from('check_ins')
          .select('member_id, checked_in_at')
          .eq('gym_id', gym.id)
          .in('member_id', lostIds)
          .order('checked_in_at', { ascending: false })
      : Promise.resolve({ data: [] as Array<{ member_id: string | null; checked_in_at: string | null }> }),
  ]);

  // Most recent visit per member.
  const lastByMember = new Map<string, string>();
  for (const v of lastVisits ?? []) {
    if (v.member_id && v.checked_in_at && !lastByMember.has(v.member_id)) {
      lastByMember.set(v.member_id, v.checked_in_at);
    }
  }

  const rows = (profiles ?? [])
    .map((p) => ({ ...p, lastVisit: lastByMember.get(p.id) ?? null }))
    .sort((a, b) => {
      // Never-visited first (most concerning), then oldest visit first.
      if (!a.lastVisit && b.lastVisit) return -1;
      if (a.lastVisit && !b.lastVisit) return 1;
      if (!a.lastVisit && !b.lastVisit) return 0;
      return (a.lastVisit ?? '') < (b.lastVisit ?? '') ? -1 : 1;
    });

  return (
    <div className="gf-page">
      <PageHeader
        title="Lost members"
        subtitle={`Active members who haven't visited recently — a starting point for win-back outreach.`}
      />

      <Card>
        <div className="gf-chip-row" style={{ padding: '12px 18px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {WINDOW_OPTIONS.map((w) => (
            <Link
              key={w.id}
              href={`?days=${w.id}`}
              className={`gf-chip${window.id === w.id ? ' active' : ''}`}
              style={{ textDecoration: 'none' }}
            >
              {w.label}
            </Link>
          ))}
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={UserX}
            title="Everyone's been by recently"
            message={`No active member has been absent for ${window.days}+ days. Nice retention.`}
          />
        ) : (
          <div className="gf-table-wrap">
            <table className="gf-table gf-table-cards">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Email / phone</th>
                  <th>Last visit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <Link href={`/admin/members/${m.id}`} style={{ fontWeight: 600, color: 'var(--gf-text)', textDecoration: 'none' }}>
                        {m.full_name ?? [m.first_name, m.last_name].filter(Boolean).join(' ') ?? '—'}
                      </Link>
                    </td>
                    <td className="gf-table-meta">
                      {m.email ?? '—'}
                      {m.phone ? <><br /><span style={{ fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 11 }}>{m.phone}</span></> : null}
                    </td>
                    <td>{m.lastVisit ? fmtDate(m.lastVisit) : <span style={{ color: 'var(--gf-text-muted)' }}>Never visited</span>}</td>
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
