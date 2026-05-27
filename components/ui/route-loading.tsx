export function RouteLoading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="gf-route-loading" role="status" aria-live="polite">
      <span className="gf-spinner gf-spinner-lg" />
      <span className="gf-route-loading-label">{label}…</span>
    </div>
  );
}
