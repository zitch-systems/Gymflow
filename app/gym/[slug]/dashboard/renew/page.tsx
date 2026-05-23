import Link from 'next/link';
import { requireMember } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira } from '@/lib/format';
import { PaystackPayButton } from './paystack-pay';

type PageProps = { params: Promise<{ slug: string }> };

export default async function RenewPage({ params }: PageProps) {
  const { slug } = await params;
  const { user, gym } = await requireMember(slug);

  const supabase = await createClient();
  const { data: plans } = await supabase
    .from('membership_plans')
    .select('*')
    .eq('gym_id', gym.id)
    .eq('is_active', true)
    .order('price', { ascending: true });

  return (
    <div className="gf-page">
      <header className="gf-page-header">
        <div>
          <h1 className="gf-page-title">Renew membership</h1>
          <p className="gf-page-subtitle">Pick a plan to extend your membership at {gym.name}.</p>
        </div>
        <Link href="/dashboard" className="gf-btn gf-btn-ghost gf-btn-sm">
          Back to dashboard
        </Link>
      </header>

      {!plans || plans.length === 0 ? (
        <div className="gf-card">
          <div className="gf-empty">
            <div className="gf-empty-icon">📋</div>
            <div className="gf-empty-title">No plans available</div>
            <div className="gf-empty-text">The gym hasn&apos;t published any active plans yet.</div>
          </div>
        </div>
      ) : (
        <div className="plan-grid">
          {plans.map((p) => (
            <article key={p.id} className="plan-card">
              <h3 className="plan-card-title">{p.name}</h3>
              <p className="plan-card-meta">
                {p.duration_months} month{p.duration_months === 1 ? '' : 's'}
              </p>
              <p className="plan-card-price">{fmtNaira(p.price)}</p>
              {p.description && <p className="plan-card-desc">{p.description}</p>}
              <PaystackPayButton
                gymId={gym.id}
                planId={p.id}
                amount={p.price}
                durationMonths={p.duration_months}
                email={user.email ?? ''}
                subaccount={gym.paystack_subaccount_code}
              />
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
