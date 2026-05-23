import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireMember } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDate } from '@/lib/format';
import { SubscribeButton } from './subscribe-button';
import { ManageSubscription } from './manage-subscription';

type PageProps = { params: Promise<{ slug: string; id: string }> };

export default async function InstructorDetailPage({ params }: PageProps) {
  const { slug, id } = await params;
  const { user, gym } = await requireMember(slug);
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: link } = await supabase
    .from('gym_staff_links')
    .select('user_id, profiles:user_id(id, full_name, photo_url, bio, specialisation, certifications, email)')
    .eq('gym_id', gym.id)
    .eq('user_id', id)
    .eq('role', 'instructor')
    .eq('is_active', true)
    .maybeSingle();

  const p = link && (Array.isArray(link.profiles) ? link.profiles[0] : link.profiles);
  if (!p) notFound();

  const [{ data: pricing }, { data: subs }, { data: sessions }] = await Promise.all([
    supabase
      .from('instructor_pricing')
      .select('price, billing_period, duration_days')
      .eq('gym_id', gym.id)
      .eq('instructor_id', id)
      .eq('is_active', true)
      .eq('billing_period', 'monthly')
      .maybeSingle(),
    supabase
      .from('instructor_subscriptions')
      .select('id, status, start_date, end_date, amount_paid')
      .eq('gym_id', gym.id)
      .eq('instructor_id', id)
      .eq('member_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('instructor_sessions')
      .select('id, scheduled_at, duration_minutes, status, notes')
      .eq('gym_id', gym.id)
      .eq('instructor_id', id)
      .eq('member_id', user.id)
      .order('scheduled_at', { ascending: false })
      .limit(20),
  ]);

  const price = pricing?.price ? Number(pricing.price) : null;
  const activeSub = (subs ?? []).find((s) => s.status === 'active' && s.end_date && s.end_date >= today);

  return (
    <div className="member-portal">
      <header className="member-header">
        <div>
          <h1 className="gf-page-title">{p.full_name ?? 'Coach'}</h1>
          {p.specialisation && <p className="gf-page-subtitle">{p.specialisation}</p>}
        </div>
        <Link href="/dashboard/instructors" className="gf-btn gf-btn-ghost gf-btn-sm">Back</Link>
      </header>

      <section className="gf-card" style={{ padding: 18 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 16 }}>
          {p.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.photo_url} alt="" style={{ width: 80, height: 80, borderRadius: '50%', objectFit: 'cover' }} />
          ) : (
            <div className="gf-avatar gf-avatar-lg" style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)', fontSize: '1.5rem' }}>
              {(p.full_name ?? 'C').charAt(0).toUpperCase()}
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            {price !== null && (
              <p style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>
                {fmtNaira(price)} <span style={{ fontSize: '0.875rem', color: 'var(--gf-text-muted)', fontWeight: 400 }}>/ month</span>
              </p>
            )}
          </div>
        </div>
        {p.bio && <p style={{ margin: '0 0 12px', color: 'var(--gf-text-secondary)', lineHeight: 1.6 }}>{p.bio}</p>}
        {p.certifications && (
          <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--gf-text-muted)' }}>📜 {p.certifications}</p>
        )}
      </section>

      {activeSub ? (
        <section className="gf-card" style={{ padding: 18 }}>
          <div style={{ padding: 12, background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)', borderRadius: 8, fontSize: '0.875rem', fontWeight: 600, textAlign: 'center', marginBottom: 12 }}>
            ✓ Subscribed · ends {activeSub.end_date ? fmtDate(activeSub.end_date) : '—'}
          </div>
          <ManageSubscription slug={slug} subscriptionId={activeSub.id} />
        </section>
      ) : price !== null ? (
        <section className="gf-card" style={{ padding: 18 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '1rem' }}>Subscribe</h3>
          <SubscribeButton
            gymId={gym.id}
            instructorId={id}
            instructorName={p.full_name ?? 'Coach'}
            email={user.email ?? ''}
            priceMonthly={price}
            subaccount={gym.paystack_subaccount_code}
          />
        </section>
      ) : (
        <section className="gf-card" style={{ padding: 18 }}>
          <p style={{ margin: 0, color: 'var(--gf-text-muted)', fontSize: '0.875rem' }}>
            Pricing not yet published. {p.email && <>Reach out: <a className="gf-link" href={`mailto:${p.email}`}>{p.email}</a></>}
          </p>
        </section>
      )}

      {subs && subs.length > 0 && (
        <section className="gf-card">
          <header className="gf-card-header"><h2 className="gf-card-title">Subscription history</h2></header>
          <div className="gf-table-wrap">
            <table className="gf-table">
              <thead><tr><th>Status</th><th>Start</th><th>End</th><th>Paid</th></tr></thead>
              <tbody>
                {subs.map((s) => (
                  <tr key={s.id}>
                    <td><span className={`status-pill ${s.status === 'active' ? 'on' : 'off'}`}>{s.status ?? '—'}</span></td>
                    <td>{s.start_date ? fmtDate(s.start_date) : '—'}</td>
                    <td>{s.end_date ? fmtDate(s.end_date) : '—'}</td>
                    <td>{fmtNaira(Number(s.amount_paid ?? 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {sessions && sessions.length > 0 && (
        <section className="gf-card">
          <header className="gf-card-header"><h2 className="gf-card-title">Session history</h2></header>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {sessions.map((s) => (
              <li key={s.id} style={{ padding: '12px 18px', borderTop: '1px solid var(--gf-border)', display: 'flex', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 500 }}>{fmtDate(s.scheduled_at)}</div>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--gf-text-muted)' }}>
                    {new Date(s.scheduled_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })} · {s.duration_minutes} min
                  </div>
                </div>
                <span className={`status-pill ${s.status === 'completed' ? 'on' : 'off'}`}>{s.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
