import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isPlatformAdmin, requireAuth } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { fmtDate } from '@/lib/format';

type PageProps = { searchParams: Promise<{ q?: string }> };

export default async function SuperadminMemberSearchPage({ searchParams }: PageProps) {
  await requireAuth();
  if (!(await isPlatformAdmin())) redirect('/');

  const { q } = await searchParams;
  const query = (q ?? '').trim();

  const admin = createAdminClient();
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
      <header className="gf-page-header">
        <div>
          <h1 className="gf-page-title">Find a member</h1>
          <p className="gf-page-subtitle">Search across every gym — email, phone, or name.</p>
        </div>
        <Link href="/superadmin" className="gf-btn gf-btn-ghost gf-btn-sm">Back</Link>
      </header>

      <form className="gf-card" style={{ padding: 18 }}>
        <div className="gf-form-group" style={{ marginBottom: 0 }}>
          <input
            name="q"
            defaultValue={query}
            className="gf-input"
            placeholder="email@example.com · 0801… · Ada Okeke"
            autoFocus
          />
        </div>
        <button type="submit" className="gf-btn gf-btn-primary" style={{ marginTop: 12 }}>Search</button>
      </form>

      {query && (
        <section className="gf-card">
          <header className="gf-card-header">
            <h2 className="gf-card-title">{results.length} result{results.length === 1 ? '' : 's'} for &ldquo;{query}&rdquo;</h2>
          </header>
          {results.length > 0 ? (
            <div className="gf-table-wrap">
              <table className="gf-table">
                <thead>
                  <tr><th>Name</th><th>Contact</th><th>Role</th><th>Gyms</th><th>Joined</th></tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>{r.full_name ?? '—'}</td>
                      <td>
                        <div>{r.email ?? '—'}</div>
                        <div className="gf-table-meta">{r.phone ?? '—'}</div>
                      </td>
                      <td><span className="gf-table-meta">{r.role ?? '—'}</span></td>
                      <td>
                        {r.gyms.length === 0 ? (
                          <span className="gf-table-meta">—</span>
                        ) : (
                          r.gyms.map((g, i) => (
                            <div key={i}>
                              <a
                                href={`https://${g.gym_slug}.gymflow.ng/admin/dashboard`}
                                target="_blank"
                                rel="noreferrer"
                                className="gf-link"
                              >
                                {g.gym_name}
                              </a>
                              {g.status && <span className="gf-table-meta"> · {g.status}</span>}
                            </div>
                          ))
                        )}
                      </td>
                      <td>{r.created_at ? fmtDate(r.created_at) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="gf-empty">
              <div className="gf-empty-icon">🔍</div>
              <div className="gf-empty-title">No matches</div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
