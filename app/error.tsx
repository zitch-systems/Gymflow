'use client';

import { useEffect } from 'react';

// Route-segment error boundary. Catches render/data errors in any page below
// the root layout and offers a recovery (reset) without a full reload.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Surface to the server logs / monitoring; the digest correlates with the
    // server-side stack Next records for this error.
    console.error('[app/error]', error);
  }, [error]);

  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '2rem', textAlign: 'center', background: 'var(--gf-bg, #0a0a12)', color: 'var(--gf-text, #f4f4f7)' }}>
      <div style={{ maxWidth: 460 }}>
        <h1 style={{ fontSize: '1.5rem', margin: '0 0 0.5rem' }}>Something went wrong</h1>
        <p style={{ color: 'var(--gf-text-muted, #9a9aa8)', margin: '0 0 1.5rem' }}>
          An unexpected error occurred. You can try again — if it keeps happening, please contact support.
        </p>
        {error.digest && (
          <p style={{ fontSize: '0.75rem', color: 'var(--gf-text-muted, #9a9aa8)', margin: '0 0 1.5rem' }}>
            Reference: <code>{error.digest}</code>
          </p>
        )}
        <button onClick={reset} className="gf-btn gf-btn-primary gf-btn-lg" style={{ cursor: 'pointer' }}>
          Try again
        </button>
      </div>
    </main>
  );
}
