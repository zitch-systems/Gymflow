import { redirect } from 'next/navigation';
import { isPlatformAdmin, requireAuth } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Search, SearchX } from 'lucide-react';

type PageProps = { searchParams: Promise<{ q?: string }> };

export default async function SuperadminMemberSearchPage({ searchParams }: PageProps) {
  await requireAuth();
  if (!(await isPlatformAdmin())) redirect('/');

  const { q } = await searchParams;
  const query = (q ?? '').trim();

  const admin = await createClient();
  let results: Array<{
    id: string;
    full_name: string | null;
    email: string | null;
    phone: string | null;
    role: string | null;
    created_at: string | null;
    gyms: { gym_id: string | null; gym_name: string; gym_slug: string; status: string | null }[];
  }> = [];

  if (query) {
    const term = `%${query}%`;
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, full_name, email, phone, role, created_at')
      .or(`email.ilike.${term},phone.ilike.${term},full_name.ilike.${term}`)
      .limit(50);

    const ids = (profiles ?? []).map((p) => p.id);
    const { data: linksData } = ids.length > 0
      ? await admin
          .from('gym_member_links')
          .select('user_id, gym_id, status, gyms:gym_id(name, slug)')
          .in('user_id', ids)
      : { data: [] as Array<{ user_id: string | null; gym_id: string | null; status: string | null; gyms: { name: string; slug: string } | { name: string; slug: string }[] | null }> };

    const linksByUser = new Map<string, typeof results[number]['gyms']>();
    (linksData ?? []).forEach((l) => {
      if (!l.user_id) return;
      const g = Array.isArray(l.gyms) ? l.gyms[0] : l.gyms;
      const list = linksByUser.get(l.user_id) ?? [];
      list.push({
        gym_id: l.gym_id ?? null,
        gym_name: g?.name ?? '—',
        gym_slug: g?.slug ?? '',
        status: l.status,
      });
      linksByUser.set(l.user_id, list);
    });

    results = (profiles ?? []).map((p) => ({
      ...p,
      gyms: linksByUser.get(p.id) ?? [],
    }));
  }

  return (
    <div className="gf-page">
      <div className="page-h">
        <div>
          <h1>Find a member</h1>
          <p>Search across every gym — email, phone, or name.</p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">Search</div>
        <div className="panel-desc">Cross-tenant lookup; results show every gym the member is linked to.</div>
        <form className="toolbar" style={{ marginBottom: 0 }}>
          <div className="search">
            <input
              name="q"
              defaultValue={query}
              className="gf-input"
              placeholder="email@example.com · 0801… · Ada Okeke"
              autoFocus
            />
          </div>
          <div style={{ flex: 1 }} />
          <Button type="submit" variant="primary" size="sm" leadingIcon={<Search size={14} strokeWidth={1.75} />}>
            Search
          </Button>
        </form>
      </div>

      {query && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-h">
            <div>
              <h3>{results.length} result{results.length === 1 ? '' : 's'}</h3>
              <div className="sub">For &ldquo;{query}&rdquo;</div>
            </div>
          </div>
          {results.length > 0 ? (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Contact</th>
                  <th>Role</th>
                  <th>Gyms</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => {
                  const name = r.full_name ?? r.email ?? '—';
                  const initial = name.charAt(0).toUpperCase();
                  return (
                    <tr key={r.id}>
                      <td>
                        <div className="who">
                          <span className="gf-avatar gf-avatar-sm">{initial}</span>
                          <div>
                            <strong>{r.full_name ?? '—'}</strong>
                            <small>{r.email ?? '—'}</small>
                          </div>
                        </div>
                      </td>
                      <td style={{ color: 'var(--gf-text-secondary)' }}>{r.phone ?? '—'}</td>
                      <td>
                        <span className="gf-badge gf-badge-neutral">
                          <span className="gf-dot" />
                          {r.role ?? 'member'}
                        </span>
                      </td>
                      <td>
                        {r.gyms.length === 0 ? (
                          <span style={{ color: 'var(--gf-text-muted)' }}>—</span>
                        ) : (
                          r.gyms.map((g, i) => (
                            <div key={i} style={{ fontSize: '0.86rem' }}>
                              <a
                                href={`https://${g.gym_slug}.gymflow.ng/admin/dashboard`}
                                target="_blank"
                                rel="noreferrer"
                                className="gf-link"
                              >
                                {g.gym_name}
                              </a>
                              {g.status && <span style={{ color: 'var(--gf-text-muted)' }}> · {g.status}</span>}
                            </div>
                          ))
                        )}
                      </td>
                      <td style={{ color: 'var(--gf-text-secondary)' }}>{r.created_at ? fmtDate(r.created_at) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <EmptyState icon={SearchX} title="No matches" message="Try a different email, phone, or name." />
          )}
        </div>
      )}
    </div>
  );
}
