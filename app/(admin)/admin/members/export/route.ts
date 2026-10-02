import { requireStaff, ADMIN_ROLES } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { gymHasFeature, upgradeMessage } from '@/lib/entitlements';
import { csvFilename, toCsv } from '@/lib/csv';
import { chunksOf, readBoundedPages } from '@/lib/paged-query';

// Cap on rows per export. Reached => the CSV carries a truncation notice.
const EXPORT_LIMIT = 5000;

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Profile = { id: string; full_name: string | null; email: string | null; phone: string | null };
type Sub = { id: string; member_id: string | null; plan_id: string | null; status: string | null; end_date: string | null };
type Plan = { id: string; name: string | null };

// GET /admin/members/export — CSV of the gym's members (staff only).
export async function GET() {
  const { gym } = await requireStaff(ADMIN_ROLES);
  // Tier gate: data exports are Growth+ (enforced here, not just displayed).
  if (!gymHasFeature(gym, 'analytics_exports')) {
    return new Response(upgradeMessage('analytics_exports'), { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  const supabase = await createClient();

  const { rows: links, truncated } = await readBoundedPages(
    (from, to) => supabase
      .from('gym_member_links').select('id, user_id, member_id, joined_at, is_active')
      .eq('gym_id', gym.id)
      // A unique tie-breaker is required for offset pagination: several imports
      // can share joined_at, and rows must not move between adjacent pages.
      .order('joined_at', { ascending: false }).order('id', { ascending: false })
      .range(from, to),
    EXPORT_LIMIT,
  );

  const ids = [...new Set(links.map((l) => (l.member_id ?? l.user_id)).filter(Boolean) as string[])];
  const profiles: Profile[] = [];
  const subs: Sub[] = [];
  // Small IN lists avoid URL-length failures and make the 1,000-row API ceiling
  // irrelevant for profiles. Subscription history can exceed a page, so each
  // chunk is explicitly paged and refuses an incomplete join.
  for (const idChunk of chunksOf(ids, 100)) {
    const { data: profilePage, error: profileError } = await supabase
      .from('profiles').select('id, full_name, email, phone').in('id', idChunk);
    if (profileError) throw new Error(`Member export profile query failed: ${profileError.message}`);
    profiles.push(...((profilePage ?? []) as Profile[]));

    const subPage = await readBoundedPages(
      (from, to) => supabase.from('member_subscriptions')
        .select('id, member_id, plan_id, status, end_date')
        .eq('gym_id', gym.id).in('member_id', idChunk)
        .order('end_date', { ascending: false, nullsFirst: false }).order('id', { ascending: false })
        .range(from, to),
      EXPORT_LIMIT,
    );
    if (subPage.truncated) throw new Error('Member export subscription history exceeds the safe join limit.');
    subs.push(...(subPage.rows as Sub[]));
  }
  const plans: Plan[] = [];
  const planIds = [...new Set(subs.map((sub) => sub.plan_id).filter(Boolean) as string[])];
  for (const idChunk of chunksOf(planIds, 100)) {
    const { data, error } = await supabase.from('membership_plans')
      .select('id, name').eq('gym_id', gym.id).in('id', idChunk);
    if (error) throw new Error(`Member export plan query failed: ${error.message}`);
    plans.push(...((data ?? []) as Plan[]));
  }

  const pById = new Map((profiles ?? []).map((p) => [p.id, p as Profile]));
  const planById = new Map(plans.map((p) => [p.id, p.name]));
  // subs came back ordered by end_date desc — keep the FIRST hit per member
  // (their live/most-recent sub) rather than letting later historical rows
  // clobber it via Map.set. Using a plain for-loop makes the intent
  // "first-wins" explicit; new Map(entries) would silently reverse it.
  const subByMember = new Map<string, Sub>();
  for (const s of (subs ?? []) as Sub[]) {
    if (s.member_id && !subByMember.has(s.member_id)) subByMember.set(s.member_id, s);
  }

  const header = ['Name', 'Email', 'Phone', 'Plan', 'Status', 'Renews', 'Joined', 'Active'];
  const body = links.map((l) => {
    const mid = (l.member_id ?? l.user_id) as string;
    const p = pById.get(mid);
    const sub = subByMember.get(mid);
    const plan = sub?.plan_id ? (planById.get(sub.plan_id) ?? '') : '';
    return [
      p?.full_name ?? '', p?.email ?? '', p?.phone ?? '', plan,
      sub?.status ?? '', sub?.end_date ?? '',
      l.joined_at ? String(l.joined_at).slice(0, 10) : '', l.is_active ? 'yes' : 'no',
    ];
  });

  // Same reason as the accounting export: a silently short member list reads
  // as "this is everyone" and gets used for outreach and headcount.
  if (truncated) {
    body.push([
      `EXPORT TRUNCATED — only the most recent ${EXPORT_LIMIT} members are included.`,
      '', '', '', '', '', '', '',
    ]);
  }

  const csv = toCsv(header, body);
  const filename = csvFilename('members', gym.name);

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      ...(truncated ? { 'X-Export-Truncated': String(EXPORT_LIMIT) } : {}),
    },
  });
}
