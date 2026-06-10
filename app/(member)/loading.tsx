// Instant feedback for member-app navigations (home/classes/wallet/inbox…).
export default function MemberLoading() {
  return (
    <section className="view on" aria-busy="true" aria-label="Loading">
      <div className="gf-skel" style={{ height: 52, margin: '10px 0 14px' }} />
      <div className="gf-skel" style={{ height: 150, marginBottom: 14 }} />
      <div className="gf-skel" style={{ height: 92, marginBottom: 10 }} />
      <div className="gf-skel" style={{ height: 92 }} />
    </section>
  );
}
