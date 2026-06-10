// Instant feedback while a /coach/* page's queries run.
export default function CoachLoading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="gf-skel" style={{ height: 34, width: 240, marginBottom: 18 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 18 }}>
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="gf-skel" style={{ height: 104 }} />)}
      </div>
      <div className="gf-skel" style={{ height: 340 }} />
    </div>
  );
}
