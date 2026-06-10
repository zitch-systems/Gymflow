// Instant feedback while a /superadmin/* page's queries run.
export default function SuperadminLoading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="gf-skel" style={{ height: 34, width: 280, marginBottom: 18 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 18 }}>
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="gf-skel" style={{ height: 104 }} />)}
      </div>
      <div className="gf-skel" style={{ height: 360 }} />
    </div>
  );
}
