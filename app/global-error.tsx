'use client';

import { useEffect } from 'react';

// Last-resort boundary: catches errors thrown by the root layout itself, which
// the per-segment error.tsx cannot. Must render its own <html>/<body>.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[app/global-error]', error);
  }, [error]);

  return (
    <html lang="en" data-theme="dark">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#0a0a12', color: '#f4f4f7' }}>
        <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '2rem', textAlign: 'center' }}>
          <div style={{ maxWidth: 460 }}>
            <h1 style={{ fontSize: '1.5rem', margin: '0 0 0.5rem' }}>Something went wrong</h1>
            <p style={{ color: '#9a9aa8', margin: '0 0 1.5rem' }}>
              The application hit an unexpected error. Please reload the page.
            </p>
            <button
              onClick={reset}
              style={{ cursor: 'pointer', padding: '0.7rem 1.4rem', borderRadius: 10, border: 'none', background: '#6c5ce7', color: '#fff', fontWeight: 600, fontSize: '0.95rem' }}
            >
              Reload
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
