import Link from 'next/link';
import { requireMember } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { CardActions } from './card-actions';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ArrowLeft, CreditCard } from 'lucide-react';

type PageProps = { params: Promise<{ slug: string }> };

export default async function SavedCardsPage({ params }: PageProps) {
  const { slug } = await params;
  const { user, gym } = await requireMember(slug);

  const supabase = await createClient();
  const { data: cards } = await supabase
    .from('saved_cards')
    .select('id, last4, brand, card_type, bank, exp_month, exp_year, is_default, is_active, created_at')
    .eq('member_id', user.id)
    .eq('gym_id', gym.id)
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false });

  return (
    <div className="ds-member">
      <div className="view on" data-v="cards">
        <div className="mhead" style={{ justifyContent: 'space-between', paddingBottom: 6 }}>
          <Link href="/dashboard" className="icon-btn" style={{ width: 34, height: 34 }} aria-label="Back">
            <ArrowLeft strokeWidth={1.9} />
          </Link>
          <strong className="htitle">Saved cards</strong>
          <span style={{ width: 34, height: 34 }} aria-hidden />
        </div>

        {cards && cards.length > 0 ? (
          <div className="group">
            {cards.map((c) => (
              <div key={c.id} className="method">
                <span className={`brandmark ${(c.brand ?? '').toLowerCase().includes('master') ? 'mc' : 'visa'}`}>
                  {(c.brand ?? 'CARD').slice(0, 4).toUpperCase()}
                </span>
                <div className="m">
                  <strong>•••• •••• •••• {c.last4 ?? '????'}</strong>
                  <small>
                    {c.bank ?? c.card_type ?? '—'} · exp {c.exp_month ?? '--'}/{c.exp_year ?? '--'}
                    {c.is_default ? ' · default' : ''}
                  </small>
                </div>
                {c.is_default && <span className="gf-badge gf-badge-brand">Default</span>}
                <CardActions cardId={c.id} isDefault={!!c.is_default} />
              </div>
            ))}
          </div>
        ) : (
          <Card>
            <EmptyState
              icon={CreditCard}
              title="No saved cards yet"
              message={<>Cards are saved automatically the first time you pay — head to <Link href="/dashboard/renew" className="gf-link">renew</Link> to add one.</>}
            />
          </Card>
        )}
      </div>
    </div>
  );
}
