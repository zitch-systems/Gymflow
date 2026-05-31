import Link from 'next/link';
import { requireInstructor } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';
import { EmptyState } from '@/components/ui/empty-state';
import { Users } from 'lucide-react';

type PageProps = { params: Promise<{ slug: string }> };

export default async function CoachClientsPage({ params }: PageProps) {
  const { slug } = await params;
  const { gym, user } = await requireInstructor(slug);
  const supabase = await createClient();

  const today = new Date().toISOString().slice(0, 10);

  const { data: subs } = await supabase
    .from('instructor_subscriptions')
    .select('id, member_id, status, start_date, end_date, amount_paid, profiles:member_id(full_name, email, phone)')
    .eq('gym_id', gym.id)
    .eq('instructor_id', user.id)
    .order('created_at', { ascending: false });

  // Group by member; last sub wins for status
  const byMember = new Map<string, { memberId: string; name: string; email: string | null; phone: string | null; status: string; endDate: string | null; totalPaid: number }>();
  (subs ?? []).forEach((s) => {
    if (!s.member_id) return;
    const p = Array.isArray(s.profiles) ? s.profiles[0] : s.profiles;
    const existing = byMember.get(s.member_id);
    const isActive = s.status === 'active' && s.end_date && s.end_date >= today;
    if (!existing) {
      byMember.set(s.member_id, {
        memberId: s.member_id,
        name: p?.full_name ?? p?.email ?? 'Member',
        email: p?.email ?? null,
        phone: p?.phone ?? null,
        status: isActive ? 'active' : (s.status ?? 'inactive'),
        endDate: s.end_date,
        totalPaid: Number(s.amount_paid) || 0,
      });
    } else {
      existing.totalPaid += Number(s.amount_paid) || 0;
      if (isActive) existing.status = 'active';
    }
  });

  const clients = Array.from(byMember.values()).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="member-portal member-app">
      <header className="member-header">
        <div>
          <h1 className="gf-page-title">Clients</h1>
          <p className="gf-page-subtitle">{clients.length} subscriber{clients.length === 1 ? '' : 's'}</p>
        </div>
        <Link href="/coach" className="gf-btn gf-btn-ghost gf-btn-sm">Back</Link>
      </header>

      {clients.length > 0 ? (
        <div className="m-links">
          {clients.map((c) => (
            <Link key={c.memberId} href={`/coach/clients/${c.memberId}`} className="m-lc">
              <span className="m-lc-ic-lg" aria-hidden>{c.name.charAt(0).toUpperCase()}</span>
              <div className="m-lc-m">
                <strong>{c.name}</strong>
                <small>{c.email ?? c.phone ?? '—'}</small>
              </div>
              <span className="m-lc-end">
                <span className={`status-pill ${c.status === 'active' ? 'on' : 'off'}`}>{c.status}</span>
                <small>{c.endDate ? `until ${fmtDate(c.endDate)}` : '—'}</small>
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState icon={Users} title="No clients yet" message="Members who subscribe to you will appear here." />
      )}
    </div>
  );
}
