import Link from 'next/link';
import { requireMember } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira } from '@/lib/format';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ArrowLeft, Dumbbell } from 'lucide-react';
import { PtPackBuyButton } from './buy-button';

type PageProps = { params: Promise<{ slug: string }> };

type Pack = { id: string; name: string; instructor_id: string; session_count: number; price: number; is_active: boolean };
type Credit = { id: string; instructor_id: string; pack_id: string | null; sessions_total: number; sessions_used: number; purchased_at: string };

export default async function MemberPtPacksPage({ params }: PageProps) {
  const { slug } = await params;
  const { user, gym } = await requireMember(slug);
  const supabase = await createClient();
  // The gym row from requireMember already has paystack_subaccount_code
  // (getGymBySlug selects '*'), so no extra query is needed.
  const subaccount = (gym as unknown as { paystack_subaccount_code?: string | null }).paystack_subaccount_code ?? null;

  // Active packs for this gym are public to members via the RLS policy
  // pt_packs_select_gym_members, so the user client works here.
  const { data: packsRaw } = await supabase
    .from('pt_packs' as never)
    .select('id, name, instructor_id, session_count, price, is_active')
    .eq('gym_id' as never, gym.id)
    .eq('is_active' as never, true)
    .order('created_at' as never, { ascending: false });

  const packs = (packsRaw ?? []) as unknown as Pack[];

  const instructorIds = [...new Set(packs.map((p) => p.instructor_id))];
  const { data: instructorProfiles } = instructorIds.length
    ? await supabase.from('profiles').select('id, full_name, first_name, last_name').in('id', instructorIds)
    : { data: [] as Array<{ id: string; full_name: string | null; first_name: string | null; last_name: string | null }> };
  const coachLabel = new Map((instructorProfiles ?? []).map((p) => [p.id, p.full_name ?? [p.first_name, p.last_name].filter(Boolean).join(' ') ?? 'Coach'] as const));

  // The member's existing balances — read via the user client, RLS scopes to
  // member_id = auth.uid().
  const { data: creditsRaw } = await supabase
    .from('pt_pack_credits' as never)
    .select('id, instructor_id, pack_id, sessions_total, sessions_used, purchased_at')
    .eq('gym_id' as never, gym.id)
    .eq('member_id' as never, user.id)
    .order('purchased_at' as never, { ascending: false });
  const credits = (creditsRaw ?? []) as unknown as Credit[];

  return (
    <div className="ds-member">
      <div className="view on" data-v="pt-packs">
        <div className="mhead" style={{ justifyContent: 'space-between', paddingBottom: 6 }}>
          <Link href="/dashboard" className="icon-btn" style={{ width: 34, height: 34 }} aria-label="Back">
            <ArrowLeft strokeWidth={1.9} />
          </Link>
          <strong className="htitle">PT packs</strong>
          <span style={{ width: 34, height: 34 }} aria-hidden />
        </div>

        {credits.length > 0 && (
          <>
            <div className="sect-t">Your balance</div>
            <div className="group" style={{ marginBottom: 14 }}>
              {credits.map((c) => {
                const remaining = c.sessions_total - c.sessions_used;
                return (
                  <div key={c.id} className="row" style={{ opacity: remaining === 0 ? 0.55 : 1 }}>
                    <span className="ic"><Dumbbell /></span>
                    <div className="m">
                      <strong>{remaining} session{remaining === 1 ? '' : 's'} left</strong>
                      <small>with {coachLabel.get(c.instructor_id) ?? 'Coach'} · {c.sessions_used} of {c.sessions_total} used</small>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className="sect-t">Available packs ({packs.length})</div>
        {packs.length === 0 ? (
          <Card>
            <EmptyState
              icon={Dumbbell}
              title="No packs on offer"
              message={`${gym.name} hasn't published any personal training packs yet.`}
            />
          </Card>
        ) : (
          <div className="group">
            {packs.map((p) => (
              <div key={p.id} className="row" style={{ alignItems: 'flex-start' }}>
                <span className="ic"><Dumbbell /></span>
                <div className="m">
                  <strong>{p.name}</strong>
                  <small>{p.session_count} session{p.session_count === 1 ? '' : 's'} · with {coachLabel.get(p.instructor_id) ?? 'Coach'}</small>
                  <div style={{ marginTop: 6, fontFamily: 'var(--gf-font-display)', fontWeight: 800, fontSize: '1.15rem', color: 'var(--gf-brand)' }}>
                    {fmtNaira(p.price)}
                  </div>
                </div>
                <PtPackBuyButton
                  packId={p.id}
                  packName={p.name}
                  amount={p.price}
                  email={user.email ?? ''}
                  subaccount={subaccount}
                />
              </div>
            ))}
          </div>
        )}

        <p style={{ textAlign: 'center', marginTop: 16, fontSize: '0.78rem', color: 'var(--gf-text-muted)' }}>
          Need a refund? <Link href="/dashboard" style={{ color: 'var(--gf-brand)', textDecoration: 'none' }}>Contact the gym</Link>.
        </p>
      </div>
    </div>
  );
}
