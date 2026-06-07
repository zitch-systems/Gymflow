'use server';

import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth/gym';
import { getSessionUser } from '@/lib/auth/dal';
import { audit } from '@/lib/audit';

export type CsvResult = {
  ok: true;
  filename: string;
  csv: string;
  rows: number;
} | {
  ok: false;
  error: string;
};

const COLUMNS = ['member_id', 'full_name', 'email', 'phone', 'joined_at', 'status', 'membership_status', 'membership_end_date', 'days_left'] as const;

/**
 * Escape a single CSV cell per RFC 4180:
 *   - wrap in double quotes if it contains comma / quote / newline / CR
 *   - escape internal quotes by doubling them
 *   - null/undefined → empty
 */
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function daysLeft(endDate: string | null | undefined): number | '' {
  if (!endDate) return '';
  const ms = new Date(endDate + 'T00:00:00Z').getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

/**
 * Export every member of the current gym as a CSV string. Compliance-sensitive
 * data (phone, status, billing dates) — gated on requireStaff and audited.
 */
export async function exportMembersCsv(slug: string): Promise<CsvResult> {
  const { gym } = await requireStaff(slug);
  const actor = await getSessionUser();
  const supabase = await createClient();

  const { data: links } = await supabase
    .from('gym_member_links')
    .select('user_id, joined_at, status')
    .eq('gym_id', gym.id)
    .order('joined_at', { ascending: false });

  const memberIds = (links ?? []).map((l) => l.user_id).filter((id): id is string => !!id);

  const [{ data: profiles }, { data: memberships }] = await Promise.all([
    memberIds.length
      ? supabase.from('profiles').select('id, full_name, first_name, last_name, email, phone').in('id', memberIds)
      : Promise.resolve({ data: [] }),
    memberIds.length
      ? supabase
          .from('memberships')
          .select('member_id, status, end_date')
          .eq('gym_id', gym.id)
          .in('member_id', memberIds)
          .order('end_date', { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const activeByMember = new Map<string, { status: string | null; end_date: string }>();
  for (const m of memberships ?? []) {
    if (!m.member_id) continue;
    // The first row (latest end_date) wins — same logic as the members page.
    if (!activeByMember.has(m.member_id)) {
      activeByMember.set(m.member_id, { status: m.status, end_date: m.end_date });
    }
  }

  const lines: string[] = [COLUMNS.join(',')];
  for (const link of links ?? []) {
    if (!link.user_id) continue;
    const p = profileById.get(link.user_id);
    const m = activeByMember.get(link.user_id);
    const name = p?.full_name ?? [p?.first_name, p?.last_name].filter(Boolean).join(' ') ?? '';
    lines.push(
      [
        csvCell(link.user_id),
        csvCell(name),
        csvCell(p?.email),
        csvCell(p?.phone),
        csvCell(link.joined_at),
        csvCell(link.status),
        csvCell(m?.status),
        csvCell(m?.end_date),
        csvCell(daysLeft(m?.end_date)),
      ].join(','),
    );
  }

  const csv = lines.join('\n');
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${gym.slug}-members-${stamp}.csv`;
  const rows = lines.length - 1; // exclude header

  await audit({
    gymId: gym.id,
    actorId: actor?.id ?? null,
    action: 'admin.members_exported',
    table: 'gym_member_links',
    after: { row_count: rows, filename },
  });

  return { ok: true, filename, csv, rows };
}
