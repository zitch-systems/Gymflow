import Link from 'next/link';
import { requireMember } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { CardActions } from './card-actions';

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
    <div className="gf-page">
      <header className="gf-page-header">
        <div>
          <h1 className="gf-page-title">Saved cards</h1>
          <p className="gf-page-subtitle">Cards we use for auto-renewal at {gym.name}.</p>
        </div>
        <Link href="/dashboard" className="gf-btn gf-btn-ghost gf-btn-sm">
          Back to dashboard
        </Link>
      </header>

      {cards && cards.length > 0 ? (
        <ul className="gf-list" style={{ background: 'var(--gf-surface)', border: '1px solid var(--gf-border)', borderRadius: 'var(--gf-radius)' }}>
          {cards.map((c) => (
            <li key={c.id} className="gf-list-row" style={{ alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600 }}>
                  {(c.brand ?? 'Card').toUpperCase()} •••• {c.last4 ?? '????'}
                  {c.is_default && (
                    <span className="status-pill on" style={{ marginLeft: 8 }}>
                      Default
                    </span>
                  )}
                </div>
                <div className="gf-table-meta">
                  {c.bank ?? c.card_type ?? '—'} · expires {c.exp_month ?? '--'}/{c.exp_year ?? '--'}
                </div>
              </div>
              <CardActions cardId={c.id} isDefault={!!c.is_default} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="gf-card">
          <div className="gf-empty">
            <div className="gf-empty-icon">💳</div>
            <div className="gf-empty-title">No saved cards yet</div>
            <div className="gf-empty-text">
              Cards are saved automatically the first time you pay — head to <Link href="/dashboard/renew">renew</Link> to add one.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
