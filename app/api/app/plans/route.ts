import { requireApiMember, json, corsPreflight } from '@/lib/api-app';
import { daysLeft } from '@/lib/format';
import { offersTrainer, trainerAddonPrice, planTotalPrice } from '@/lib/plan-addon';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export function OPTIONS() {
  return corsPreflight();
}

type Plan = {
  id: string; name: string; price: number | null; description: string | null;
  duration_days: number | null; duration_months: number | null;
  trainer_addon_enabled: boolean | null; trainer_addon_price: number | null;
};

// GET /api/app/plans — what this gym sells, and where the member currently
// stands. Every price the app shows comes from lib/plan-addon.ts, the same
// arithmetic the checkout initializes and fulfilment re-derives against: a
// second copy on the device is how a member gets quoted one number and charged
// another.
export async function GET(req: Request) {
  const auth = await requireApiMember(req);
  if (!auth.ok) return auth.res;
  const { supabase, user, gym } = auth.ctx;

  try {
    const [{ data: plans }, { data: sub }] = await Promise.all([
      supabase.from('membership_plans')
        .select('id, name, price, duration_days, duration_months, description, trainer_addon_enabled, trainer_addon_price')
        .eq('gym_id', gym.id).eq('is_active', true).order('price', { ascending: true }),
      supabase.from('member_subscriptions')
        .select('end_date, plan_id, status, membership_plans(name)')
        .eq('member_id', user.id).eq('gym_id', gym.id).eq('status', 'active')
        .order('end_date', { ascending: false }).limit(1).maybeSingle(),
    ]);

    const remaining = sub?.end_date ? daysLeft(sub.end_date) : 0;

    return json({
      plans: ((plans ?? []) as Plan[]).map((p) => ({
        id: p.id,
        name: p.name,
        price: Number(p.price ?? 0),
        description: p.description,
        duration_days: p.duration_days,
        duration_months: p.duration_months,
        trainer_addon: offersTrainer(p)
          ? { available: true, price: trainerAddonPrice(p), total_with_trainer: planTotalPrice(p, true) }
          : { available: false, price: 0, total_with_trainer: Number(p.price ?? 0) },
        is_current: sub?.plan_id === p.id,
      })),
      current: sub
        ? {
            plan_name: (sub as unknown as { membership_plans: { name: string } | null }).membership_plans?.name ?? null,
            end_date: sub.end_date,
            days_left: remaining,
          }
        : null,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}
