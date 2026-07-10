// Instant feedback while a member tab streams in. The bottom tab bar lives in
// the (member) layout and stays put; this fills the viewport with a generic
// header + stat-row + card skeleton until the page's data resolves.
export default function MemberLoading() {
  return (
    <div aria-busy="true" aria-live="polite" style={{ padding: '18px var(--gut) 30px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div className="gf-skel" style={{ width: 44, height: 44, borderRadius: '50%' }} />
        <div style={{ flex: 1 }}>
          <div className="gf-skel" style={{ height: 18, width: '55%', marginBottom: 8 }} />
          <div className="gf-skel" style={{ height: 13, width: '35%' }} />
        </div>
      </div>
      <div className="gf-skel" style={{ height: 150, marginBottom: 14 }} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        {[0, 1, 2, 3].map((i) => <div key={i} className="gf-skel" style={{ height: 84 }} />)}
      </div>
      <div className="gf-skel" style={{ height: 120 }} />
    </div>
  );
}
