import Link from 'next/link';
import { requireMember } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira, fmtDate } from '@/lib/format';
import { EmptyState } from '@/components/ui/empty-state';
import { Card } from '@/components/ui/card';
import { ArrowLeft, GraduationCap, Award, ChevronRight } from 'lucide-react';

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
    if (activeSubByInstructor.has(s.instructor_id)) return;
    activeSubByInstructor.set(s.instructor_id, { id: s.id, status: s.status ?? 'inactive', end_date: s.end_date });
  });

  return (
    <div className="member-portal member-app">
      <header className="member-header">
        <div>
          <h1 className="gf-page-title">Coaches</h1>
          <p className="gf-page-subtitle">Subscribe to a coach for 1-on-1 attention.</p>
        </div>
        <Link href="/dashboard" className="gf-btn gf-btn-ghost gf-btn-sm" aria-label="Back">
          <ArrowLeft size={16} strokeWidth={1.75} /> Back
        </Link>
      </header>

      {(!staffLinks || staffLinks.length === 0) ? (
        <Card>
          <EmptyState
            icon={GraduationCap}
            title="No coaches at this gym yet"
            message="Check back soon — your gym is still onboarding instructors."
          />
        </Card>
      ) : (
        <div className="m-links">
          {staffLinks.map((s) => {
            const p = Array.isArray(s.profiles) ? s.profiles[0] : s.profiles;
            if (!p?.id) return null;
            const price = priceByInstructor.get(p.id);
            const sub = activeSubByInstructor.get(p.id);
            const isActive = sub?.status === 'active' && sub.end_date && sub.end_date >= today;
            return (
              <Link key={p.id} href={`/dashboard/instructors/${p.id}`} className="m-lc m-lc-coach">
                {p.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.photo_url} alt="" className="m-lc-photo" />
                ) : (
                  <span className="m-lc-ic m-lc-ic-lg">
                    {(p.full_name ?? 'C').charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="m-lc-m">
                  <strong>{p.full_name ?? 'Coach'}</strong>
                  <small>
                    {p.specialisation ?? 'Instructor'}
                    {price ? ` · ${fmtNaira(price)}/mo` : ''}
                  </small>
                  {p.certifications && (
                    <small className="m-lc-certs">
                      <Award size={11} strokeWidth={2} /> {p.certifications}
                    </small>
                  )}
                </span>
                {isActive && sub ? (
                  <span className="gf-badge gf-badge-brand">Active · {sub.end_date ? fmtDate(sub.end_date) : '—'}</span>
                ) : (
                  <ChevronRight size={18} strokeWidth={1.9} className="m-lc-chev" />
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
