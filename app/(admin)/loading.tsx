// Instant feedback while an /admin/* page's queries run. The admin shell
// (sidebar/topbar) persists across client navigations, so this swaps into the
// content area immediately on click instead of a frozen screen.
export default function AdminLoading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="gf-skel" style={{ height: 34, width: 260, marginBottom: 18 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 18 }}>
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="gf-skel" style={{ height: 104 }} />)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16 }}>
        <div className="gf-skel" style={{ height: 360 }} />
        <div className="gf-skel" style={{ height: 360 }} />
      </div>
    </div>
  );
}
