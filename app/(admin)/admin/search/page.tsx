import type { Route } from 'next';
import Link from 'next/link';
import { Search, Users, CalendarDays, Tag, ChevronRight } from 'lucide-react';
import { requireStaff } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtNaira } from '@/lib/format';
import {
  MIN_QUERY_LENGTH, countHits, ilikeOrFilter, isSearchable, looksLikeEmail,
  rankMatches, sanitizeSearchTerm, type SearchHit,
} from '@/lib/admin-search';

export const metadata = { title: 'Search' };
export const dynamic = 'force-dynamic';

// Destination of the console top-bar search box, which until now was an input
// that did nothing on every admin page. Searches the three things staff actually
// look up by name — a member, a class, a plan — in one gym-scoped pass.
//
// Every query is scoped to requireStaff()'s gym: members via the
// gym_member_links !inner join (so a search only ever touches this tenant's
// roster rather than scanning profiles platform-wide), classes and plans by
// gym_id. Terms are sanitised in lib/admin-search before reaching a filter.

const GROUP_META: Record<SearchHit['kind'], { label: string; icon: typeof Users }> = {
  member: { label: 'Members', icon: Users },
  class: { label: 'Classes', icon: CalendarDays },
  plan: { label: 'Plans', icon: Tag },
};

export default async function AdminSearch({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const raw = sp.q ?? '';
  const term = sanitizeSearchTerm(raw);
  const { gym } = await requireStaff();

  let groups: { kind: SearchHit['kind']; hits: SearchHit[] }[] = [];

  if (isSearchable(term)) {
    const supabase = await createClient();
    const [{ data: people }, { data: classes }, { data: plans }] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name, first_name, last_name, email, gym_member_links!inner(gym_id, is_active)')
        .eq('gym_member_links.gym_id', gym.id)
        .eq('gym_member_links.is_active', true)
        .or(ilikeOrFilter(['full_name', 'email'], term))
        .limit(20),
      supabase
        .from('classes')
        .select('id, name, instructor, is_active')
        .eq('gym_id', gym.id)
        .or(ilikeOrFilter(['name', 'instructor'], term))
        .limit(10),
      supabase
        .from('membership_plans')
        .select('id, name, price, is_active')
        .eq('gym_id', gym.id)
        .or(ilikeOrFilter(['name'], term))
        .limit(10),
    ]);

    type Person = { id: string; full_name: string | null; first_name: string | null; last_name: string | null; email: string | null };
    const memberHits: SearchHit[] = rankMatches(
      (people ?? []) as unknown as Person[],
      term,
      (p) => p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || '',
    ).map((p) => ({
      kind: 'member' as const,
      id: p.id,
      title: p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || 'Member',
      subtitle: p.email,
      href: `/admin/members/${p.id}`,
    }));

    type ClassRow = { id: string; name: string | null; instructor: string | null; is_active: boolean | null };
    const classHits: SearchHit[] = rankMatches((classes ?? []) as ClassRow[], term, (c) => c.name ?? '')
      .map((c) => ({
        kind: 'class' as const,
        id: c.id,
        title: c.name ?? 'Class',
        subtitle: [c.instructor, c.is_active === false ? 'Inactive' : null].filter(Boolean).join(' · ') || null,
        href: `/admin/classes/${c.id}`,
      }));

    type PlanRow = { id: string; name: string | null; price: number | null; is_active: boolean | null };
    const planHits: SearchHit[] = rankMatches((plans ?? []) as PlanRow[], term, (p) => p.name ?? '')
      .map((p) => ({
        kind: 'plan' as const,
        id: p.id,
        title: p.name ?? 'Plan',
        subtitle: [fmtNaira(Number(p.price ?? 0)), p.is_active === false ? 'Inactive' : null].filter(Boolean).join(' · '),
        href: `/admin/pricing/${p.id}/edit`,
      }));

    groups = [
      { kind: 'member' as const, hits: memberHits },
      { kind: 'class' as const, hits: classHits },
      { kind: 'plan' as const, hits: planHits },
    ]
      // An email is unambiguously a person — never bury them under a class that
      // happened to match. Otherwise keep the natural member/class/plan order.
      .sort((a, b) => (looksLikeEmail(term) && a.kind === 'member' ? -1 : b.kind === 'member' && looksLikeEmail(term) ? 1 : 0))
      .filter((g) => g.hits.length > 0);
  }

  const total = countHits(groups);

  return (
    <>
      <div className="page-h">
        <div>
          <h1>Search</h1>
          <p>
            {!isSearchable(term)
              ? `Type at least ${MIN_QUERY_LENGTH} characters to search ${gym.name}.`
              : `${total} result${total === 1 ? '' : 's'} for “${term}” in ${gym.name}`}
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="toolbar">
          <form className="search" action="/admin/search" style={{ display: 'flex', flex: 1 }}>
            <Search strokeWidth={1.75} />
            <input
              name="q"
              defaultValue={term}
              placeholder="Search members, classes, plans…"
              aria-label="Search"
              autoFocus
            />
          </form>
        </div>

        {!isSearchable(term) ? (
          <div className="empty">
            <div className="eic"><Search strokeWidth={1.6} /></div>
            <h3>Search this gym</h3>
            <p>Find a member by name or email, a class, or a membership plan.</p>
          </div>
        ) : total === 0 ? (
          <div className="empty">
            <div className="eic"><Search strokeWidth={1.6} /></div>
            <h3>No matches</h3>
            <p>Nothing in {gym.name} matches “{term}”. Try a different spelling.</p>
          </div>
        ) : (
          groups.map((g) => {
            const meta = GROUP_META[g.kind];
            const Icon = meta.icon;
            return (
              <div key={g.kind} style={{ marginBottom: 18 }}>
                <div className="panel-h">
                  <div>
                    <h3 style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                      <Icon strokeWidth={1.9} size={16} /> {meta.label}
                    </h3>
                    <div className="sub">{g.hits.length} match{g.hits.length === 1 ? '' : 'es'}</div>
                  </div>
                </div>
                {g.hits.map((h) => (
                  <Link
                    key={`${h.kind}-${h.id}`}
                    href={h.href as Route}
                    className="mt"
                    style={{ textDecoration: 'none', color: 'inherit' }}
                  >
                    <span className="gf-avatar gf-avatar-sm">{h.title.charAt(0).toUpperCase()}</span>
                    <div className="m"><strong>{h.title}</strong><small>{h.subtitle ?? '—'}</small></div>
                    <span className="t"><ChevronRight strokeWidth={2} size={16} /></span>
                  </Link>
                ))}
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
