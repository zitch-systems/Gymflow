import Link from 'next/link';
import { Repeat, Users, CreditCard, Check, Pencil, PlusCircle } from 'lucide-react';
import { requireStaff } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira } from '@/lib/format';

export const metadata = { title: 'Pricing & plans' };

function periodSuffix(months: number): string {
  if (months <= 1) return '/mo'; if (months === 3) return '/qtr'; if (months === 12) return '/yr'; return `/${months}mo`;
}

export default async function AdminPricing() {
  const { gym } = await requireStaff();
  const supabase = await createClient();

  const [{ data: plans }, { data: activeSubs }] = await Promise.all([
    supabase.from('membership_plans').select('id, name, price, duration_months, description, is_active, features').eq('gym_id', gym.id).order('price', { ascending: true }),
    supabase.from('member_subscriptions').select('plan_id').eq('gym_id', gym.id).eq('status', 'active'),
  ]);

  const countByPlan = new Map<string, number>();
  for (const s of activeSubs ?? []) if (s.plan_id) countByPlan.set(s.plan_id, (countByPlan.get(s.plan_id) ?? 0) + 1);

  const rows = (plans ?? []).map((p) => {
    const members = countByPlan.get(p.id) ?? 0;
    const perMonth = Number(p.price) / Math.max(1, p.duration_months);
    return { ...p, members, mrr: perMonth * members };
  });
  const subscribers = rows.reduce((s, r) => s + r.members, 0);
  const mrrTotal = rows.reduce((s, r) => s + r.mrr, 0);
  const arpu = subscribers > 0 ? mrrTotal / subscribers : 0;
  const popularId = rows.reduce<{ id: string | null; n: number }>((best, r) => (r.members > best.n ? { id: r.id, n: r.members } : best), { id: null, n: -1 }).id;

  return (
    <>
      <div className="page-h"><div><h1>Pricing &amp; plans</h1><p>{rows.length} plan{rows.length === 1 ? '' : 's'} · {fmtNaira(Math.round(mrrTotal))} monthly recurring</p></div></div>

      <section className="kpis" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#c6f24e1f', color: '#a8d92e' }}><Repeat strokeWidth={1.9} /></div></div><div className="kpi-val">{fmtNaira(Math.round(mrrTotal))}</div><div className="kpi-lbl">Monthly recurring</div></div>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#11d18b1f', color: '#11d18b' }}><Users strokeWidth={1.9} /></div></div><div className="kpi-val">{subscribers}</div><div className="kpi-lbl">On a paid plan</div></div>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#4080ff1f', color: '#4080ff' }}><CreditCard strokeWidth={1.9} /></div></div><div className="kpi-val">{fmtNaira(Math.round(arpu))}</div><div className="kpi-lbl">Avg revenue / member</div></div>
      </section>

      {rows.length === 0 ? (
        <div className="panel"><div className="empty"><div className="eic"><CreditCard strokeWidth={1.6} /></div><h3>No plans yet</h3><p>Create a membership plan to start taking subscriptions.</p></div></div>
      ) : (
        <div className="plans">
          {rows.map((p) => {
            const feats = Array.isArray(p.features) ? (p.features as string[]) : ['Full gym access', 'Class booking', 'Auto-renew'];
            const pop = p.id === popularId && p.members > 0;
            return (
              <div className={`plan${pop ? ' pop' : ''}`} key={p.id}>
                <div className="plan-top">
                  <span className="nm">{p.name}{pop && <span className="gf-badge gf-badge-brand" style={{ marginLeft: 6 }}>Popular</span>}</span>
                  <Link href={`/admin/pricing/${p.id}/edit`} className="icon-btn" style={{ width: 32, height: 32 }} aria-label="Edit plan"><Pencil strokeWidth={1.9} /></Link>
                </div>
                <div className="amt">{fmtNaira(Number(p.price))}<small>{periodSuffix(p.duration_months)}</small></div>
                <div className="desc">{p.description ?? `${p.duration_months}-month membership`}</div>
                <div className="stat">
                  <div><div className="v">{p.members}</div><div className="l">Members</div></div>
                  <div><div className="v">{fmtNaira(Math.round(p.mrr))}</div><div className="l">MRR</div></div>
                </div>
                <ul>{feats.slice(0, 3).map((f, i) => <li key={i}><Check strokeWidth={2.2} /> {f}</li>)}</ul>
                <div className="acts">
                  <Link href={`/admin/pricing/${p.id}/edit`} className={`gf-btn gf-btn-${pop ? 'primary' : 'secondary'} gf-btn-sm gf-btn-full`} style={{ textDecoration: 'none' }}>Edit plan</Link>
                </div>
              </div>
            );
          })}
          <Link href="/admin/pricing/new" className="addplan" style={{ textDecoration: 'none' }}><div className="in"><PlusCircle strokeWidth={1.6} /><div style={{ fontFamily: 'var(--gf-font-display)', fontWeight: 600, marginTop: 8 }}>Add a new plan</div></div></Link>
        </div>
      )}
    </>
  );
}
