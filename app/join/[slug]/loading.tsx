// Invite links get opened on phones over slow networks — show progress while
// the gym resolves.
export default function JoinLoading() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }} aria-busy="true">
      <div className="gfui-spin" style={{ width: 30, height: 30 }} />
      <p style={{ color: 'var(--gf-text-secondary)', fontSize: '0.92rem', margin: 0 }}>Loading your gym…</p>
    </div>
  );
}
