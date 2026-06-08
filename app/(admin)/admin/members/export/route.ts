import { requireStaff } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Profile = { id: string; full_name: string | null; email: string | null; phone: string | null };
type Sub = { member_id: string | null; plan_id: string | null; status: string | null; end_date: string | null };
type Plan = { id: string; name: string | null };

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// GET /admin/members/export — CSV of the gym's members (staff only).
export async function GET() {
  const { gym } = await requireStaff();
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

  const csv = [header, ...body].map((r) => r.map(csvCell).join(',')).join('\n');
  const slug = (gym.name ?? 'gym').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const filename = `members-${slug}-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
