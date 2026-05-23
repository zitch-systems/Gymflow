import Link from 'next/link';

export function PortStub({ title, legacy }: { title: string; legacy: string }) {
  return (
    <div className="gf-page">
      <header className="gf-page-header">
        <div>
          <h1 className="gf-page-title">{title}</h1>
          <p className="gf-page-subtitle">Port in progress · legacy source: {legacy}</p>
        </div>
        <Link href="/" className="gf-btn gf-btn-ghost gf-btn-sm">
          Home
        </Link>
      </header>
      <div className="gf-empty">
        <div className="gf-empty-icon">🚧</div>
        <div className="gf-empty-title">This page is being ported</div>
        <div className="gf-empty-text">
          Authentication and routing work. The full UI / data wiring for <strong>{title}</strong> is the next port.
        </div>
      </div>
    </div>
  );
}
