import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requireMember } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { daysLeft } from '@/lib/format';
import { RenewPicker, type Plan } from './renew-picker';

export const metadata = { title: 'Renew membership' };

export default async function RenewPage() {
  const { user, gym } = await requireMember();
  const supabase = await createClient();

  const [{ data: plans }, { data: sub }] = await Promise.all([
    supabase.from('membership_plans')
      .select('id, name, price, duration_months, description')
      .eq('gym_id', gym.id).eq('is_active', true).order('price', { ascending: true }),
    supabase.from('member_subscriptions')
      .select('end_date, plan_id, status, membership_plans(name)')
      .eq('member_id', user.id).eq('gym_id', gym.id).eq('status', 'active')
      .order('end_date', { ascending: false }).limit(1).maybeSingle(),
  ]);

  const remaining = sub?.end_date ? daysLeft(sub.end_date) : 0;
  const curPlan = (sub as unknown as { membership_plans: { name: string } | null })?.membership_plans?.name ?? null;
  const context = remaining > 0
    ? `Your ${curPlan ?? 'membership'} renews in ${remaining} day${remaining === 1 ? '' : 's'}. Renew early to lock in your rate.`
    : `Pick a plan to start training at ${gym.name}.`;

  return (
    <section className="view on" data-v="renew">
      <div className="mhead" style={{ justifyContent: 'space-between', paddingBottom: 10 }}>
        <Link href="/dashboard/wallet" className="icon-btn" style={{ width: 34, height: 34 }} aria-label="Back to wallet"><ArrowLeft strokeWidth={1.9} /></Link>
        <strong className="htitle">Renew membership</strong>
        <span style={{ width: 34 }} />
      </div>

      <p style={{ color: 'var(--gf-text-secondary)', fontSize: '0.88rem', margin: '0 0 16px' }}>{context}</p>

      {(plans ?? []).length === 0 ? (
        <div className="empty"><div className="eic" /><h3>No plans available</h3><p>This gym hasn&apos;t published any plans yet.</p></div>
      ) : (
        <RenewPicker plans={(plans ?? []) as Plan[]} />
      )}
    </section>
  );
}
