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
    <div className="member-portal member-app">
      <header className="member-header">
        <div>
          <h1 className="gf-page-title">Saved cards</h1>
          <p className="gf-page-subtitle">For auto-renewal at {gym.name}.</p>
        </div>
        <Link href="/dashboard" className="gf-btn gf-btn-ghost gf-btn-sm" aria-label="Back">
          <ArrowLeft size={16} strokeWidth={1.75} /> Back
        </Link>
      </header>

      {cards && cards.length > 0 ? (
        <div className="m-links">
          {cards.map((c) => (
            <div key={c.id} className="m-lc">
              <span className="m-lc-ic"><CreditCard size={18} strokeWidth={1.9} /></span>
              <span className="m-lc-m">
                <strong>
                  {(c.brand ?? 'Card').toUpperCase()} •••• {c.last4 ?? '????'}
                  {c.is_default && <span className="gf-badge gf-badge-brand" style={{ marginLeft: 8, fontSize: '0.62rem' }}>Default</span>}
                </strong>
                <small>{c.bank ?? c.card_type ?? '—'} · exp {c.exp_month ?? '--'}/{c.exp_year ?? '--'}</small>
              </span>
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
  );
}
