// Instant feedback while an /admin/* tab streams in. The sidebar/topbar live in
// the (admin) layout and stay interactive; this fills the content pane with a
// generic header + KPI-row + panel skeleton until the page's data resolves.
export default function AdminLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div style={{ marginBottom: 22 }}>
        <div className="gf-skel" style={{ height: 30, width: 260, marginBottom: 10 }} />
        <div className="gf-skel" style={{ height: 15, width: 380, maxWidth: '80%' }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 18 }}>
        {[0, 1, 2, 3].map((i) => <div key={i} className="gf-skel" style={{ height: 108 }} />)}
      </div>
      <div style={{ display: 'grid', gap: 14 }}>
        <div className="gf-skel" style={{ height: 260 }} />
        <div className="gf-skel" style={{ height: 180 }} />
      </div>
    </div>
  );
}
