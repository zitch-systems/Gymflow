import { requireStaff, ADMIN_ROLES } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { gymHasFeature, upgradeMessage } from '@/lib/entitlements';
import { csvFilename, toCsv } from '@/lib/csv';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Profile = { id: string; full_name: string | null; email: string | null; phone: string | null };
type Sub = { member_id: string | null; plan_id: string | null; status: string | null; end_date: string | null };
type Plan = { id: string; name: string | null };

// GET /admin/members/export — CSV of the gym's members (staff only).
export async function GET() {
  const { gym } = await requireStaff(ADMIN_ROLES);
  // Tier gate: data exports are Growth+ (enforced here, not just displayed).
  if (!gymHasFeature(gym, 'analytics_exports')) {
    return new Response(upgradeMessage('analytics_exports'), { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  const supabase = await createClient();

  const { data: links } = await supabase
    .from('gym_member_links').select('user_id, member_id, joined_at, is_active')
    .eq('gym_id', gym.id).order('joined_at', { ascending: false }).limit(5000);

  const ids = [...new Set((links ?? []).map((l) => (l.member_id ?? l.user_id)).filter(Boolean) as string[])];
  const [{ data: profiles }, { data: subs }, { data: plans }] = await Promise.all([
    ids.length ? supabase.from('profiles').select('id, full_name, email, phone').in('id', ids) : Promise.resolve({ data: [] as Profile[] }),
    ids.length ? supabase.from('member_subscriptions').select('member_id, plan_id, status, end_date').eq('gym_id', gym.id).in('member_id', ids) : Promise.resolve({ data: [] as Sub[] }),
    supabase.from('membership_plans').select('id, name').eq('gym_id', gym.id),
  ]);

  const pById = new Map((profiles ?? []).map((p) => [p.id, p as Profile]));
  const planById = new Map((plans ?? []).map((p: Plan) => [p.id, p.name]));
  const subByMember = new Map((subs ?? []).map((s) => [s.member_id, s as Sub]));

  const header = ['Name', 'Email', 'Phone', 'Plan', 'Status', 'Renews', 'Joined', 'Active'];
  const body = (links ?? []).map((l) => {
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

  const csv = toCsv(header, body);
  const filename = csvFilename('members', gym.name);

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
