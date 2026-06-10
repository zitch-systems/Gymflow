// /launch does role lookups (and possibly provisioning) before redirecting —
// show progress instead of a blank screen.
export default function LaunchLoading() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }} aria-busy="true">
      <div className="gfui-spin" style={{ width: 30, height: 30 }} />
      <p style={{ color: 'var(--gf-text-secondary)', fontSize: '0.92rem', margin: 0 }}>Opening your workspace…</p>
    </div>
  );
}
