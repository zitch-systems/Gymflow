import Link from 'next/link';
import { requireMember } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDate } from '@/lib/format';
import { EmptyState } from '@/components/ui/empty-state';
import { GraduationCap, Award } from 'lucide-react';

type PageProps = { params: Promise<{ slug: string }> };

export default async function MemberInstructorsPage({ params }: PageProps) {
  const { slug } = await params;
  const { user, gym } = await requireMember(slug);
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  // Active instructors at this gym, joined to their profile + monthly pricing.
  const { data: staffLinks } = await supabase
    .from('gym_staff_links')
    .select('user_id, profiles:user_id(id, full_name, photo_url, bio, specialisation, certifications)')
    .eq('gym_id', gym.id)
    .eq('role', 'instructor')
    .eq('is_active', true);

  const instructorIds = (staffLinks ?? []).map((s) => s.user_id).filter(Boolean) as string[];

  const [{ data: pricing }, { data: mySubs }] = await Promise.all([
    instructorIds.length > 0
      ? supabase
          .from('instructor_pricing')
          .select('instructor_id, price, billing_period, duration_days')
          .eq('gym_id', gym.id)
          .in('instructor_id', instructorIds)
          .eq('is_active', true)
      : Promise.resolve({ data: [] as Array<{ instructor_id: string; price: number; billing_period: string | null; duration_days: number }> }),
    supabase
      .from('instructor_subscriptions')
      .select('id, instructor_id, status, end_date, start_date, amount_paid')
      .eq('gym_id', gym.id)
      .eq('member_id', user.id)
      .order('created_at', { ascending: false }),
  ]);

  const priceByInstructor = new Map<string, number>();
  (pricing ?? []).forEach((p) => {
    if (p.instructor_id && p.billing_period === 'monthly') priceByInstructor.set(p.instructor_id, Number(p.price));
  });

  const activeSubByInstructor = new Map<string, { id: string; status: string; end_date: string | null }>();
  (mySubs ?? []).forEach((s) => {
    if (!s.instructor_id) return;
    if (activeSubByInstructor.has(s.instructor_id)) return; // first/latest wins
    activeSubByInstructor.set(s.instructor_id, { id: s.id, status: s.status ?? 'inactive', end_date: s.end_date });
  });

  return (
    <div className="member-portal">
      <header className="member-header">
        <div>
          <h1 className="gf-page-title">Instructors</h1>
          <p className="gf-page-subtitle">Subscribe to a coach for 1-on-1 attention.</p>
        </div>
        <Link href="/dashboard" className="gf-btn gf-btn-ghost gf-btn-sm">Back</Link>
      </header>

      {(!staffLinks || staffLinks.length === 0) ? (
        <EmptyState
          icon={GraduationCap}
          title="No instructors at this gym yet"
          message="Check back soon — your gym is still onboarding coaches."
        />
      ) : (
        <div className="plan-grid">
          {staffLinks.map((s) => {
            const p = Array.isArray(s.profiles) ? s.profiles[0] : s.profiles;
            if (!p?.id) return null;
            const price = priceByInstructor.get(p.id);
            const sub = activeSubByInstructor.get(p.id);
            const isActive = sub?.status === 'active' && sub.end_date && sub.end_date >= today;
            return (
              <article key={p.id} className="plan-card" style={{ textAlign: 'left' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                  {p.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.photo_url} alt="" style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover' }} />
                  ) : (
                    <div className="gf-avatar gf-avatar-lg" style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)' }}>
                      {(p.full_name ?? 'C').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <h3 className="plan-card-title" style={{ margin: 0 }}>{p.full_name ?? 'Coach'}</h3>
                    {p.specialisation && <p className="plan-card-meta" style={{ margin: '2px 0 0' }}>{p.specialisation}</p>}
                  </div>
                </div>
                {p.bio && <p style={{ fontSize: '0.875rem', color: 'var(--gf-text-secondary)', margin: '0 0 12px', lineHeight: 1.5 }}>{p.bio}</p>}
                {p.certifications && (
                  <p style={{ fontSize: '0.75rem', color: 'var(--gf-text-muted)', margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Award size={13} strokeWidth={1.75} /> {p.certifications}
                  </p>
                )}

                {price ? (
                  <p className="plan-card-price" style={{ marginBottom: 12 }}>{fmtNaira(price)}<span style={{ fontSize: '0.875rem', fontWeight: 400, color: 'var(--gf-text-muted)' }}> / month</span></p>
                ) : (
                  <p className="plan-card-meta" style={{ marginBottom: 12 }}>Pricing not set</p>
                )}

                {isActive && sub ? (
                  <div style={{ padding: 8, background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)', borderRadius: 8, fontSize: '0.8125rem', fontWeight: 600, textAlign: 'center', marginBottom: 8 }}>
                    Subscribed · until {sub.end_date ? fmtDate(sub.end_date) : '—'}
                  </div>
                ) : null}

                <Link
                  href={`/dashboard/instructors/${p.id}`}
                  className={`gf-btn ${isActive ? 'gf-btn-outline' : 'gf-btn-primary'} gf-btn-full`}
                >
                  {isActive ? 'Manage' : 'View & subscribe'}
                </Link>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
