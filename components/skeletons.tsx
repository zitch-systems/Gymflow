// Shared route-transition skeletons, used by the loading.tsx boundaries. Each
// nested segment needs its own loading.tsx (a boundary only re-triggers when
// ITS child segment changes), so the markup lives here once.

export function MemberSkeleton() {
  return (
    <section className="view on" data-loading aria-busy="true" aria-label="Loading">
      <div className="mhead" style={{ paddingBottom: 8 }}>
        <span className="gf-skel" style={{ width: 130, height: 24 }} />
        <span className="gf-skel" style={{ width: 38, height: 38, marginLeft: 'auto', borderRadius: 12 }} />
      </div>
      <span className="gf-skel" style={{ display: 'block', height: 168, borderRadius: 'var(--gf-radius-lg)', marginBottom: 18 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 18 }}>
        {Array.from({ length: 4 }, (_, i) => (
          <span key={i} className="gf-skel" style={{ height: 78, borderRadius: 18 }} />
        ))}
      </div>
      {Array.from({ length: 3 }, (_, i) => (
        <span key={i} className="gf-skel" style={{ display: 'block', height: 72, borderRadius: 'var(--gf-radius)', marginBottom: 10 }} />
      ))}
    </section>
  );
}

export function ConsoleSkeleton() {
  return (
    <div data-loading aria-busy="true" aria-label="Loading">
      <div className="page-h">
        <div>
          <span className="gf-skel" style={{ display: 'block', width: 200, height: 30, marginBottom: 8 }} />
          <span className="gf-skel" style={{ display: 'block', width: 320, height: 15 }} />
        </div>
      </div>
      <section className="kpis">
        {Array.from({ length: 4 }, (_, i) => (
          <span key={i} className="gf-skel" style={{ height: 128, borderRadius: 'var(--gf-radius)' }} />
        ))}
      </section>
      <span className="gf-skel" style={{ display: 'block', height: 320, borderRadius: 'var(--gf-radius)' }} />
    </div>
  );
}
