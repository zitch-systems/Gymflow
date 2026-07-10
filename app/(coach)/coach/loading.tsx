// Instant feedback while a /coach/* tab streams in — see (admin)/admin/loading.tsx.
export default function CoachLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div style={{ marginBottom: 22 }}>
        <div className="gf-skel" style={{ height: 30, width: 260, marginBottom: 10 }} />
        <div className="gf-skel" style={{ height: 15, width: 380, maxWidth: '80%' }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 18 }}>
        {[0, 1, 2, 3].map((i) => <div key={i} className="gf-skel" style={{ height: 108 }} />)}
      </div>
      <div className="gf-skel" style={{ height: 260 }} />
    </div>
  );
}
