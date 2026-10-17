"use client";

export function ConsoleError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="panel" role="alert" style={{ maxWidth: 640, margin: '24px auto', padding: 24 }}>
    <h1 style={{ fontSize: '1.4rem', marginBottom: 10 }}>This page could not load</h1>
    <p style={{ color: 'var(--gf-text-muted)', marginBottom: 18 }}>Please try again. You can also use the menu to open another page.</p>
    <button type="button" onClick={reset} className="gf-btn gf-btn-primary">Try again</button>
  </div>;
}
